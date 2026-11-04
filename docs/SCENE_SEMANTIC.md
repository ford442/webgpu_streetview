# Semantic scene layer

#352. A street segmentation of the road frame, from a second ONNX session in
the scene-depth Worker. It runs on the same input upload as the depth model and
tells the weather and night passes what each pixel is. With it:

- the wet road appears only on road and sidewalk pixels;
- snow settles on the ground and vegetation, not on walls;
- rain thins over the sky;
- the fog bank relaxes at the skyline;
- the sky can be replaced by an analytic one;
- night relights buildings, the road and vehicles differently;
- the horizon estimate prefers the sky's lower edge.

**Opt-in only.** Turn it on with the weather panel's "Scene understanding"
toggle or `?semantic=on`. It needs scene depth to be on, because it rides in
that Worker. It is weighted only at High (0.8) and Ultra (1.0) through
`semanticBlend` in `visualPresets.ts`. The model is fetched only after opting
in: about 12 MB, once, then served from the Cache API.

**Weight 0 is bit-exact.** Every helper starts with
`if (semParams.blend <= 0.0) { return …input…; }`, and the params buffer is all
zeros without a map. `sceneSemanticBinding.test.ts` pins those first statements.
`e2e/scene-semantic.spec.ts` compares frame hashes on the real device.

## Classes

The source model has the 19 Cityscapes classes. The rebuilt model's head folds
them into 7 groups (`semanticClasses.ts`, from `semanticModel.manifest.json`):

| id | class | from (Cityscapes) | used by |
|---|---|---|---|
| 0 | sky | sky | rain thinning, fog at the skyline, sky replacement, night darkening, horizon |
| 1 | road | road | wet road, snow cover, sodium lamp pools |
| 2 | sidewalk | sidewalk | wet road (0.6), snow cover, lamp pools (0.7) |
| 3 | building | building, wall, fence, pole, traffic light, traffic sign | window emissives |
| 4 | vegetation | vegetation, terrain | snow cover (0.45), night darkening; sky seen through its branches is keyed back to sky |
| 5 | vehicle | car, truck, bus, train, motorcycle, bicycle | tail-light band |
| 6 | person | person, rider | nothing yet; kept so #342 and #343 can mask people out |

The map is `rg8unorm`:

- R is the class id + 1, so 0 means unlabelled (the fallback texel).
- G is the winning probability.

Class ids are never filtered. `classWeight(uv, cls)` interpolates the four
nearest texels' *indicators* bilinearly, which gives a one-texel feather. It
multiplies that by map coverage (fading out at the reprojected edge) and by
`semParams.blend`.

## Bundle

The layer is opt-in, so its weight sits outside the main bundle:

- **Lazy chunk** (`SemanticController.*.chunk.js`, about 2.5 KB gzip): the
  controller, the class table, the params packing and the sky edge.
  `SemanticLayer.ts` loads it when the `semantic` pass is first initialised.
- **Main bundle:** only the pass stub and options (`SemanticLayer`), the group-3
  layout and zero fallback (always bound), the toggle and the stores.
- **Depth Worker** (2.2 → 3.0 KB gzip): the second session and the decode.
- **Model:** fetched only on opt-in.

## Pipeline

```
pass-1 intermediate ─▶ GPU chores readback ─▶ depth Worker
   (never the Maps canvas, never while holdActive — same capture as depth)
                                  │ rgbaToImageNetNchw (once)
                                  ├─▶ depth session  ─▶ aux.depth     (group 2)
                                  └─▶ semantic session ─▶ probs [1,7,H,W]
                                         decodeSemanticProbs ─▶ rg8unorm
SemanticController (lazy FramePass 'semantic', order 51)
   ─▶ FrameContext.aux.semantic ─▶ weather group 3 (both shaders)
   ─▶ skyEdge ─▶ resolveHorizonFrame (slots 40–41)
```

- **One Worker, two sessions.** `DepthController` owns the scheduler (settle
  150 ms, ≤ 5 Hz, one inference in flight) and the epoch. `SemanticController`
  attaches to it as a `SemanticSink`.
  - When the sink `wantsMaps()`, each depth inference also runs the semantic
    session on the same input tensor, so there is no second readback or upload.
  - A semantic failure is counted in `failures` and never fails the depth half.
  - Every ORT session create, inference and release in the Worker goes through
    one queue (`onOrtQueue`). ORT 1.30's WebGPU backend is not re-entrant:
    creating the semantic session during a depth inference failed with
    "setPipeline … is not of type 'GPUComputePipeline'". That happens whenever
    both toggles are switched on together.
  - Switching depth off, losing the Worker or disposing it resets the sink.
- **Trust.** The confidence ramp and epoch rules are the depth ones. A map
  computed for an earlier pano never applies. While looking around, the map is
  shifted with depth's `LOOK_SCALE_H/V` until the next one lands.
- **Params** (`SceneSemanticParams`, 64 B, `SceneSemanticParamIndex`) hold:
  - `blend` (preset × confidence), the view shift and `zoom`;
  - one weight per effect (`SemanticEffectWeights`, all 1 in the product);
  - `skyR/G/B`, the photo's mean sky colour, measured by the Worker over the
    pixels it labelled sky (the sky regrade's reference and the sky key's
    colour; also on the probe as `skyColor`);
  - `stillness`, set to 1 with `prefers-reduced-motion`, which freezes clouds
    and window flicker.

## Effects (`weather-post.wgsl` fragments 01/03, `weather-post-compute.wgsl`)

Each helper body is byte-identical in both shaders, after renaming the frame
texture (`readTexture`→`sceneTex`) and the sampler (`u_sampler`→`linearSampler`).
`sceneSemanticBinding.test.ts` checks this. No helper uses `textureSample` on
`semanticTex`: class ids are read only with `textureLoad`.

| Helper | Where | What |
|---|---|---|
| `semanticRain` | wraps `rain(…)` | streaks × (1 − `rainSky` · sky weight): no streaks over the sky |
| `semanticRainParticles` | compute only, wraps the GPU precipitation layer | the same mask on the layer's rain share; snow keeps falling in front of the sky. Lens droplets are on the lens and stay. |
| `semanticFog` | wraps `fogAmountAt(…)` | fog × (1 − 0.55 · sky weight) at the skyline |
| `semanticWetRoad` | after the rain darkening | road/sidewalk only: darken, plus a rippled reflection mirrored about `sceneHorizonY()`, Fresnel by `sceneDepth` |
| `semanticSnowCover` | snow block | road, sidewalk, vegetation: noisy settled snow, thicker far away |
| `semanticRelight` | after `applyNight` | sky and vegetation sink; lit windows on buildings (local luma recess + per-cell hash); sodium pools on the road at depth-phased lamp spacing; a tail-light band on vehicles |
| `semanticSky` | after `directionalMoonlight` | analytic sky through a guided matte (see below) |

The windshield portal mirrors `weather-post`'s colour path but **never reads the
semantic map**. `windshieldPortal.parity.test.ts` asserts that, as it does for
depth. Through the glass, the road keeps its pre-#352 look.

### Sky replacement

`semanticSky` is active only when there is a *mood* to show: night, clouds
(rain, snow or fog), golden hour, or sunrise. A clear midday sky in the photo is
already the right sky and is left alone. When it is active:

- **Matte.** `semanticSkyMatte` is a joint-bilateral upsample of the sky
  indicator. The four map taps are weighted by bilinear position × colour
  similarity to the full-resolution frame, so the edge follows the photo's
  skyline and not the 1-texel map grid.
- **Sky key.** The network labels bare trees, *with the sky showing through
  them*, as vegetation. That left a twilight-blue patchwork next to a replaced
  night sky. `semanticSkyKey` handles it:
  - It compares each pixel of the photograph with the photo's own mean sky
    colour (`skyR/G/B`), measured by the Worker over the pixels the map
    labelled sky.
  - It saturates, so a sky pixel between twigs counts fully as sky and a twig
    pixel counts as nothing.
  - It acts only on vegetation pixels, fading out from 0.1 to 0.25 below the
    horizon. Grass and bushes aren't sky-coloured.

  The key widens the matte (`max(jbu, key × vegetation)`). It also gives that
  sky the night relight's sky darkening, and keeps snow cover off it.
- **Sky.** Preetham (Perez) daylight, scaled into the frame's range, plus a sun
  disk at SunCalc's sun position. SunCalc azimuth is measured from south, so
  the compass bearing is az + π. At night: a gradient, hashed stars and the moon
  at its SunCalc position. The night gradient sits near `applyNight`'s own sky
  in the frame's display-referred range, so it does not punch a black hole
  next to the graded photo. Clouds are domain-warped fbm whose cover follows
  rain, snow and fog; `stillness` freezes their drift.
- **A regrade, not a cut-out.** The photograph's own sky luma is divided by
  the luma of `skyR/G/B` and multiplied onto the new sky (85%, clamped 0.3–2.5), and the mix
  is capped at 90%. Its clouds keep their shape and stay brighter than the
  clear sky around them. This matters because the model labels some cumulus as
  vegetation or building: there the photo's cloud stays, and the seam is a
  change of colour rather than a flat slab against the photograph. The first
  version pasted the analytic sky outright, and the captures showed exactly
  that slab.

**Not done: cabin IBL from the replaced sky.** The cabin's environment
does not yet follow it (see *Deviations*).

### Horizon

`skyLowerEdge` takes the median per-column end of a sky run that starts in the
top quarter of the map, tolerating gaps of up to 2 texels. It needs sky in at
least 20% of the columns. The controller publishes it with the pose's pitch and
a sequence number.

`resolveHorizonFrame` prefers the sky edge over the row estimate while one is
present. It integrates the edge as a pitch-relative bias, so the edge follows
the camera between maps. With `horizonEstimateBlend` 0 it still returns
`HORIZON_OFF`, so it stays bit-exact with the pitch-only horizon.

## The model

| | |
|---|---|
| Model | **DDRNet23-Slim**, Cityscapes, 19 classes (~5.7 M params) |
| Source | Qualcomm AI Hub export [`qualcomm/DDRNet23-Slim`](https://huggingface.co/qualcomm/DDRNet23-Slim), `qai-hub-models` v0.65.0 ONNX float archive (21.2 MB, sha256 `b11b2168…9b71`) |
| Upstream | [`chenjun2hao/DDRNet.pytorch`](https://github.com/chenjun2hao/DDRNet.pytorch) |
| License | **MIT** (upstream and export). `public/models/semantic/NOTICE.txt` carries the attribution. |
| Served file | `ddrnet23-slim-street7.onnx`, 11.8 MB, sha256 `e543c6b6…734f` |
| Input / output | `image` `[1, 3, H, W]` (ImageNet mean/std on sRGB, the depth model's tensor) → `probs` `[1, 7, H, W]`; internally the network runs at 2H × 2W |

**Why this one.** It is MIT-licensed, under 15 MB once its weights are stored in
fp16, made of plain conv/BN/Resize operators that ORT-web's WebGPU EP runs, and
trained for street scenes. SegFormer-B0 (NVIDIA's licence is non-commercial),
Mask2Former and the Cityscapes OneFormer weights were rejected on licence or size.

The Cityscapes *dataset* has its own terms, which restrict redistributing
the dataset. We ship trained weights under the model's MIT licence, as the
upstream and Qualcomm do. Re-check this if the licence review asks.

**Rebuilt at fetch time, deterministically.** `npm run fetch:models` (or
`node scripts/fetch-models.mjs --model semantic`) works like this:

1. Downloads the pinned archive and checks its size and SHA-256.
2. Checks `labels.txt` against `sourceClasses` in the manifest.
3. Rewrites the graph with `scripts/lib/onnxSurgery.mjs`, a dependency-free
   protobuf editor:
   1. Drops the input normalisation prologue (`Sub`/`Div`), so the model takes
      the depth model's ImageNet tensor and one upload feeds both.
   2. Makes H/W symbolic, so every `Resize` takes its sizes from its skip
      tensor's `Shape`.
   3. Stores the weights as fp16 (round-to-nearest-even), each with a `Cast`
      back to f32. SwiftShader and many adapters have no `shader-f16`.
   4. Drops the stale `value_info`.
   5. Appends the class head: `Softmax` → a fixed 1×1 grouping `Conv` (the
      table above) → bilinear `Resize` from 1/8 scale to the input size.
   6. Prepends a bilinear ×`inputScale` (2) upsample of the input (see below).
4. Checks the rebuilt bytes' size and SHA-256 against the manifest, then writes
   them beside a `NOTICE.txt` and deletes the archive.

The rebuild is byte-for-byte deterministic. That is what makes the served file
pinnable, and `--check` verifies it without downloading. CI, nightly and deploy
run `npm run fetch:models` and cache both model directories keyed on the two
manifests and the surgery script.

**Why the input is upsampled ×2.** The depth tensor is about 252². A
Cityscapes network trained on 1024×2048 sees street objects at that size as
too small and collapses to one class. On the CC0 street fixture at 266×220 it
labels 94% of the frame vegetation, and only about half its pixels agree with a
640 px run. Upsampling that same tensor ×2 inside the graph brings agreement
to about 83%, close to a native 512–640 px input; ×2.5 is no better. The ×2
upsample:

- keeps the shared tensor, so there is no second readback or upload;
- keeps the class map at the depth input's size;
- costs about 4× the convolution work of the 252² run.

These were measured with onnxruntime (CPU), using rebuilds of the pinned
source at ×1 and ×2, on the fixture and a second CC0 street photo. At every scale the model still calls some clouds vegetation and
some shop fronts vehicles (see *Known limits*).

**Cache.** The Worker keeps the verified file in `streetview-semantic-model-v<cacheVersion>`
and deletes older `streetview-semantic-model-*` buckets. The service worker
never touches `/models/`. Bump `cacheVersion` whenever the archive, the surgery
or the class table changes, because any of them changes the SHA.

## Status and failure

- `webgpuProbe.passes.semantic` is absent until the layer is first switched on.
  After that it reads `ready`, or `failed(reason)` with reasons such as
  *model not deployed (HTTP 404)*, *integrity check failed* or *depth is off*.
  A failure never touches the road frame, because consumers bind the zero
  fallback (1×1 `rg8unorm` plus zero params).
- `window.__SCENE_SEMANTIC__` (also `__SV__.sceneSemantic`) has these fields:
  - `state`, `reason`;
  - download progress, `fromCache`, `createMs`;
  - `inferenceMs`, `inferences`, `failures`;
  - map size;
  - `histogram` (share per class name), `meanConfidence`, `skyEdgeY`, `skyColor`;
  - `appliedBlend`, `generation`.

## Testing

| | |
|---|---|
| `src/renderer/semantic/semanticUnits.test.ts` | class table ↔ manifest, decode (NaN → unlabelled), sky edge, params packing (all-zero without a map / at weight 0), option gating, horizon preferring the sky edge |
| `SemanticController.test.ts` | the controller on the fake device with a scripted Worker: lazy load, maps riding depth inferences, epochs, failure isolation, reset |
| `sceneSemanticBinding.test.ts` | WGSL struct and class constants ↔ TS, byte-identical helpers in both shaders, weight-0 first statements, `textureLoad`-only class reads, entry-point wiring, layout and fallback |
| `windshieldPortal.parity.test.ts` | no mirrored stage reads the semantic map |
| `depthBundleGuard.test.ts` | the semantic model and runtime stay out of the bundle |
| `e2e/scene-semantic.spec.ts` (`chromium-webgpu`) | the rebuilt model through ORT-web on SwiftShader and the production renderer: maps with a plausible histogram, weight 0 bit-exact across looks, no rain streaks over the sky, no wet change off the road, snow on the ground only, class-conditional night relight, sky replacement confined to the matte, a missing model fails the pass, not the frame |

On SwiftShader, at the depth tensor's 266×224, the semantic run takes about
22 s for the ×1 graph and about 52 s for the shipped ×2 graph. Depth takes
about 106 s. On a CPU with onnxruntime (not a GPU) the ×2 graph takes
40–100 ms. The ≤ 40 ms budget is a real-GPU number and is not measured in
CI. Read `inferenceMs` from `__SCENE_SEMANTIC__` on a GPU host.

## Deviations from the issue

- **Bundle: +2.7 KB gzip on `main`, not ±1 KB** (299.49 → 302.20 KB, Vite's
  figure). That is after moving the controller into a lazy chunk; before the
  split it was +3.4 KB. The rest is spread over several pieces:
  - the settings toggle;
  - the always-bound group-3 layout and fallback;
  - the stores and the pass stub;
  - the depth side's semantic plumbing (`DepthEstimator.loadSemantic`,
    `DepthController`'s sink).

  Getting under 1 KB would mean lazy-loading the toggle and splitting the
  estimator. Not done; flagged for review.
- **Model.** The issue does not name one. DDRNet23-Slim (MIT, 11.8 MB rebuilt)
  is the licence-safe pick (see *The model*). Seven classes, not more: the
  effects only need these.
- **Timing.** The ≤ 40 ms budget is a real-GPU number. SwiftShader runs this
  model far slower, as it does depth (about a minute). The e2e records
  `inferenceMs` as an annotation and does not assert it. Read it from
  `__SCENE_SEMANTIC__` on a GPU host.
- **Cadence.** No separate cadence. Maps ride depth inferences, which keeps the
  one-upload rule and the Worker's single queue. Turning semantic on requests one
  fresh inference.
- **Requires scene depth.** It is the same Worker and readback, and the wet
  road's Fresnel and the lamp spacing read `sceneDepth`.
- **Slice 3, cabin IBL from the replaced sky: not done.** The cabin's
  environment is three.js-side, and feeding it the analytic sky needs a
  cross-chunk handoff like `roadFrameRegistry`. That is a follow-up.
- **Slice 3, matte ≤ 2 px edge error: not measured against a ground-truth
  matte.** There is no labelled fixture. The e2e checks that replacement stays
  inside the sky region and away from the building region.
- **Horizon within 1 %: not met on the fixture, and not asserted.** The unit
  tests check that `resolveHorizonFrame` prefers the sky edge, carries it
  across pitch, and stays `HORIZON_OFF` at weight 0. On `street.jpg` the sky
  edge is 0.53 against a visual horizon near 0.73, because the clouds and low
  sky are labelled vegetation (see *Known limits*). The sky's lower edge is
  also the skyline, not the horizon, wherever buildings or trees stand in
  front of it. Keep `horizonEstimateBlend` modest until a better edge exists.
- **Slice 4.** Window, lamp and tail-light placement are procedural. They are
  class-conditional but not detected (no window or lamp detector).
- **Slice 5 (input abstraction for #342, `roadFootprint` for #343): not done.**
  The `person` and `vehicle` classes and `AuxSemantic` are the hooks.
- **Golden captures** are illustrations, not pixel goldens: `npm run
  capture:semantic-looks` writes before/after pairs to `docs/looks/semantic/`
  from the CC0 street fixture (rain, snow, night, dusk, class map). The exact
  assertions are the e2e's in-page per-pixel comparisons.

## Known limits

- One map per settled view, shifted while looking around, like depth.
- 1/8-scale logits upsampled bilinearly. Thin poles and signs are often lost to
  the building or sky classes around them.
- Cityscapes is European dashcam footage, so Street View's wide fisheye-ish
  frames, snow and night photos are out of distribution. Watch `meanConfidence`.
  Seen failures:
  - cumulus clouds, and the pale sky just above the skyline, labelled
    vegetation. On `street.jpg` that leaves the replaced sky as a patch with
    the photo's clouds below it (see `docs/looks/semantic/dusk-webgpu.jpg`).
    It also lifts the sky edge to 0.53, where the photo's horizon sits near
    0.73. Two fixes were tried and dropped. Relabelling sky-coloured
    vegetation in the decode makes the edge worse: tree-lined streets break
    the top-down sky run, so 0.53 → 0.46 here and 0.31 → 0.09 on a park path.
    A hue key with a brightness gate catches the clouds but also keys a sunlit
    pale trunk as sky;
  - ground-floor shop fronts labelled vehicle;
  - narrow painted alleys labelled almost entirely vegetation. `alley.jpg`,
    the depth fixture, is one: the full-size upstream model does the same
    there, which is why the semantic e2e uses `street.jpg`.
- The windshield portal does not show semantic effects (by design, see above).
