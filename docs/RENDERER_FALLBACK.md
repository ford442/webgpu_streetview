# Renderer Fallback and Debugging

Street View post-processing has a **WebGPU-required** boot contract:

- `webgpu`: the primary dual-pass renderer in `src/renderer/Renderer.ts` (only live weather path).
- `webgl`: **not a live backend**. SDR GLSL lives in `src/renderer/webgl/weatherReference.glsl.ts` for tests/docs. `createStreetViewRenderer` does not import a GL weather class. `?renderer=webgl` still probes WebGPU only (`webgpuProbe.webglPreferenceDeferred`).

Failed WebGPU boot probe → **hard-fail** (blocking overlay on the pano). The app does **not** construct a WebGL weather context and does **not** elevate raw Street View as a weather session.

On capable adapters (`webgpuProbe.ok` + the shared Street View `GPUDevice`) the default cabin is `THREE.WebGPURenderer({ device })` and it is **no longer a second canvas**: `src/car/interior/cabinFrameTarget.ts` points that renderer at a `THREE.RenderTarget` via `setOutputRenderTarget`, publishes the target's `GPUTexture` on `src/renderer/cabinOverlayRegistry.ts`, and `src/renderer/cabinComposite.ts` draws it over the swap chain in the road frame's own command encoder (pass 1 → weather → cabin → submit). One `requestDevice`, one `configureCanvasContext`, one presented frame. The cabin canvas stays in the DOM but `visibility: hidden` while the compositor owns the frame — three still owns it and `setSize` / pointer plumbing measure it. `?cabin=webgl` is the escape hatch back to a second WebGL context and its CSS overlay. `?cabin=webgpu` still forces the shared-device path. The cabin must **not** call `configure()` on the panorama canvas (`configureCanvasContext` lives in `deviceInit.ts`, invoked only from `Renderer.ts`). Failed `WebGPURenderer.init()` falls back to the WebGL overlay; Street View weather stays up.

Custom cabin GLSL (`ShaderMaterial`) lives in `src/shaders/` and is the WebGL-hatch path only. Production `src/car/` does not construct `THREE.ShaderMaterial`. The WebGPU cabin loads TSL NodeMaterial twins from `src/car/interior/cabinTslMaterials.ts` with the further-lazy `three/webgpu` chunk (`preloadWebGPUCabinRenderer`). The twins follow the GLSL uniform math (vanity warmth/vignette, rearview glass + true-rear sample, windshield rain/condensation/wipers, cup liquid, dashboard emitter glow). On the WebGPU cabin the windshield's twin is the *fallback* decal; with `clip-distances` it is replaced by the road-sampling portal below. **Known look delta:** none intended; a GPU screenshot compare is a follow-up (this path cannot be visually A/B'd in jsdom). Weather-post ACES owns the road — the WebGPU cabin uses `NoToneMapping` so the overlay is not double-ACES'd. `?hdr=1` / `?p3=1` still go through `configureCanvasContext`; the cabin overlay follows `?p3` as output-referred `display-p3` and does not become an HDR swapchain. Probe: `window.__CABIN_RENDERER_PROBE__` (also mirrored onto `webgpuProbe.cabin`).

On the composited path **cinema clips and snapshots are the presented frame** — no 2D re-composite. `needsCabinOverlayLatch()` (`renderer/cabinComposite.ts`) reads `renderer.isCabinCompositedInFrame()`, and `useAppCapture` / `CinemaOverlay` pass no overlay when it is false.

The 2D latch is still the path for the WebGL hatch and for any frame the compositor is not driving: `car/runtime/frameCapture.ts` publishes the post-`interior.render()` moment (the only frame in which a WebGL drawing buffer is readable — the cabin renderer has no `preserveDrawingBuffer`) and `utils/canvasRecorder.ts` latches the cabin there. Road-only stays the automatic fallback whenever car mode is not rendering. See `docs/SHARED_SESSIONS.md` § Cinema capture.

### When the compositor stands down

Any of these leaves the cabin on the CSS overlay + 2D latch, with Street View weather unaffected:

| Condition | Where |
| --- | --- |
| `?cabin=webgl`, or a failed `WebGPURenderer.init()` | `CabinFrameTarget.create` refuses a non-WebGPU cabin |
| three build without `setOutputRenderTarget` | `CabinFrameTarget.create` |
| Backend never exposes a `GPUTexture` for the target | `CabinFrameTarget.endFrame` latches once, restores the canvas |
| `cabin-composite.wgsl` failed to load / compile | `Renderer.init` logs and leaves `cabinComposite` null |
| Car mode off, or cabin has not drawn yet | `CabinCompositePass.isActive()` is false, pass is not encoded |

`window.__CABIN_RENDERER_PROBE__.composited` / `.compositeReason` report which of these is in effect.

Because the cabin no longer has a canvas of its own to animate on, the road loop stops adaptive frame-skipping while it is composited (`shouldRenderHeldFrameThisTick({ cabinComposited })`) — a skipped road frame would otherwise freeze the wipers and gauges too.

### Windshield portal (road HDR through wet glass)

The windshield is still a hole onto the road frame (`transmission: 0`), so `weather-post`'s graded, weathered image shows through it. What the portal changes is the **wet layer drawn on that hole**. With `clip-distances` on the shared device, `WindowWeatherOverlay` builds a `WindshieldPortal` (`car/interior/WindshieldPortal.ts`, shading in `cabinPortalMaterial.ts`) instead of the decal:

- **Droplet lenses.** Two grids of sliding beads. Each bead is a lens: the pixel inside it samples the road's **HDR intermediate** at the inverted, magnified position (bending harder toward the rim), converts it to the road's display look, and adds a dark rim and a specular. Everywhere else the glass stays the hole.
- **Condensation mist.** The decal's tinted film, unchanged.
- **Wet mask** (`windshieldWetMask.ts`). Per-blade wetness along the sweep, *persisted between frames*: a 128×2 R8 texture the wipers wipe and real time re-wets (faster in rain). It is stepped from `CarInteriorAnimator`'s wiper phase — the same number that swings the blade meshes, delivered through `WindowWeatherOverlay.setWipersActive`; the portal never free-runs it. Dwell (intermittent mode) and "wipers off" re-wet correctly because regrowth is real time, not phase. The decal fallback is stateless and can only show the sector under the blade *now*.
- **Clipping.** The portal mesh sits under `WorldPlaneClippingGroup` (four planes from the glass's bounding box, inset a seal's width — `windshieldAperture.ts`). three's node builder emits them as hardware clip distances. The planes are authored in the parent's local space and re-projected from `matrixWorld` on every `updateMatrixWorld`, because the cabin body rotates every frame *after* the interior update.

**What the portal reads.** `renderer/roadFrameRegistry.ts` (a second single-slot handoff, the reverse of `cabinOverlayRegistry`) exposes exactly one texture: the **pass-1 HDR intermediate** (`rgba16float` / `rg11b10ufloat`), plus its format, size, a `held` flag, and the packed weather values the road is graded with. Never the hidden Google Maps canvas, never `videoTexture`, never a rear-view feed — forward glass only, so rear-view billing rules are untouched. While a hop is held, pass 1 draws the frozen `previousFrameTexture`, so the intermediate *is* the held frame; `held` is reported on the probe. `Renderer.roadFrame.test.ts` pins that the publish block reads only `textures.intermediateTexture`.

**Why only lens interiors sample the road.** The intermediate is *pre*-`weather-post`: ungraded, no night, no fog, no ACES. Replacing the whole glass with it would show a different picture from the hole beside it (a bright daytime scene through the windshield at night). Confining the sample to beads a few pixels wide bounds any mismatch, and `createRoadDisplay` mirrors the stages that dominate the look — vibrance/saturation/contrast/temperature-tint/exposure → night → vignette → rain darkening → ACES — from the same packed values the road used (`RoadLook`, read in `Renderer.updateWeatherParams` / `updateColorParams` / `setShaderEffects`). `e2e/windshield-portal.spec.ts` shades uniform HDR texels through the real `weather-post` and through the mirror and requires them to agree (measured worst case ≈1 code value); `windshieldPortal.parity.test.ts` reads the shipped WGSL and fails, by name, when a mirrored constant or the stage order changes.

**Known deltas inside lenses** (small; beads are a few pixels wide): fog, humidity haze, dust, light shafts, lens flare, chromatic aberration, heat shimmer, headlights, dome light, sun/moon lighting, the night star field, and named-look 3D LUTs are not mirrored. Under `?hdr=1` the cabin target is 8-bit SDR, so the mirror uses the SDR ACES curve while the road uses the extended one. Under `?p3=1` the cabin converts sRGB→P3 primaries and the road does not, a slight saturation difference. The road's own screen-space `applyLensDroplets` (rain > 0.05) still draws under the cabin. The cabin runs on its own `requestAnimationFrame`, so lens content is up to one frame behind the road — the same relationship the compositor already has.

**Who owns the road texture.** The road renderer does, and destroys and replaces it on resize. `car/interior/roadFrameBinding.ts` reads it through `THREE.ExternalTexture`, which needs two guards (both verified on a real device, see the spec):

1. three's `dispose()` on an `ExternalTexture` calls `destroy()` on its source. The wrapper therefore gets `neuterDestroy(texture)`, whose `destroy()` is a no-op — a bare wrapper's `dispose()` produces `Destroyed texture … used in a submit` on the road's next frame.
2. three caches the bind-group view by size. A changed texture identity always gets a **new** wrapper, so a same-size replacement can't keep serving a view of the destroyed texture. The cabin re-reads the frame every cabin frame, before `render()`.

Because of (1), a wrapper three has finished with *can* be disposed — and is, on replacement and on `release()` — so three's per-texture bookkeeping (`renderer.info.memory.textures`, its dispose listeners) is released instead of drifting up on every road resize. That is safe only with `neuterDestroy` in place.

`RoadHdrFrame.device` names the `GPUDevice` that owns the texture. A cabin still on a previous device (the road renderer replaced without the device being lost, before the bridge hook has rebuilt car mode) refuses the frame rather than binding a foreign texture, which would be a validation error on every cabin submit.

**When the portal stands down** (the glass keeps the hole + decal overlay; nothing is an error):

| Condition | Where |
| --- | --- |
| `?cabin=webgl`, or a failed `WebGPURenderer.init()` fallback | `resolveWindshieldPortalSupport` — the WebGL cabin cannot bind the road's `GPUTexture` |
| Shared device created without `clip-distances` (adapter lacks it, or `?no_clip_distances`) | `resolveWindshieldPortalSupport`; `collectOptionalDeviceFeatures({ enableClipDistances: false })` |
| `?portal=off` | `resolveWindshieldPortalSupport` — manual toggle on a capable device |
| Quality `low` | `setupWindowWeatherOverlay` builds no weather layer at all |
| No road frame yet, renderer torn down, or device lost mid-session | `WindshieldPortal.update()` reports not-live; `WindowWeatherOverlay` swaps the decal back in that frame |
| Road frame owned by a different `GPUDevice` than the cabin's | `WindshieldPortal.update()` refuses it (`portal.reason`: "different GPUDevice") until the cabin is rebuilt on the new device |

The gate is decided once, where the cabin renderer is constructed (`createCabinRenderer`), so it cannot disagree with the backend. Probe: `window.__CABIN_RENDERER_PROBE__.portal` → `{ active, reason?, clipDistances, frameFormat?, held? }`.

**Testing it.** Unit: `windshieldWetMask` / `windshieldAperture` / `roadFrameBinding` / `windshieldPortalSupport` / `windshieldPortal.parity` / `WindowWeatherOverlay` / `Renderer.roadFrame` tests. GPU: `npx playwright test --project=chromium-webgpu e2e/windshield-portal.spec.ts` drives `e2e/fixtures/windshield-portal/*` on Chromium's software WebGPU adapter (SwiftShader, which exposes `clip-distances`); in that project a missing adapter is a failure, not a skip. Manual: car mode, rain on, WebGPU host — wiper arcs should leave a clean strip that re-wets; `?portal=off` or `?no_clip_distances` should fall back to the hole + decal with no console errors.

## Backend Selection

Use URL flags:

```text
?renderer=webgpu
?renderer=webgl
?webgpu
?webgl
?legacyTransitions=1
?no_gpu_compute
```

With no flag (or `auto` / `webgpu`), the app probes **WebGPU only**. On failure it hard-fails with `window.webgpuProbe` + a blocking UI.

`?renderer=webgl` / `?webgl` / `setBackend('webgl')` do **not** start a WebGL weather session. Preference is recorded (`webgpuProbe.webglPreferenceDeferred`) and the boot still probes WebGPU only. GLSL reference: `src/renderer/webgl/weatherReference.glsl.ts`.

The selected backend is exposed for browser automation and debugging:

```js
window.rendererType              // "webgpu" when ready; unset on hard-fail
window.usingWebGPU               // boolean
window.usingWebGL                // always false (no live GL weather backend)
window.rendererFallbackReason    // string, empty when WebGPU is active; probe reason on hard-fail
window.webgpuProbe               // { ok, stage, reason, browserBrand, adapter, preference, webglPreferenceDeferred, capabilityMatrix }
```

`window.webgpuProbe.browserBrand` distinguishes Chrome vs Edge (and others) so device-matrix failures are not hidden behind a silent GL rescue. `#216` gpu-chores must check `webgpuProbe.ok` (or share the single Renderer `GPUDevice`) and must **not** call `requestDevice` after a failed probe.

Persist a preference or change debug settings from DevTools:

```js
window.streetViewRendererDebug.setBackend('webgpu');
window.streetViewRendererDebug.setBackend('auto');
window.streetViewRendererDebug.setBackend('webgl'); // ignored as a weather backend — reloads, still probes WebGPU
window.streetViewRendererDebug.getBackend();
```

The backend preference is stored in `localStorage` as `streetview.renderer`.

Legacy zoom/fade transition shaders (`transition-fade|zoom|zoom-blur|zoom-chromatic.wgsl`) are **opt-in** and only loaded when `?legacyTransitions=1` (or `?legacyTransitions=true`) is set. By default, production navigation uses the hold-pause path only.

## WebGPU Init Contract

`Renderer.ts` now uses an explicit adapter/configuration policy before creating pipelines:

- **Adapter request policy** — `?gpu=` takes a comma-separated token list (e.g. `?gpu=high,compat`):
  - `?gpu=low` / `?gpu=low-power` => `requestAdapter({ powerPreference: 'low-power' })`
  - `?gpu=high` / `?gpu=high-performance` => `requestAdapter({ powerPreference: 'high-performance' })`
  - `?gpu=fallback` (alias `software`) => `forceFallbackAdapter: true` — SwiftShader / software adapter for CI and boot-probe runs.
  - `?gpu=compat` (alias `compatibility`) => `featureLevel: 'compatibility'`; the default is `featureLevel: 'core'`.
  - `?gpu=features` => dump attempted/enabled optional features as JSON on the expanded WebGPU chip. Does **not** change `requestAdapter` options. Combine with other tokens (`?gpu=high,features`).
  - `featureLevel` is only sent when the browser exposes the field (duck-typed via `GPUAdapter.prototype`), so older Chrome still boots with the historical request shape. When it is not sent, the capability matrix reports `featureLevel: 'unknown'`.
  - Otherwise, battery heuristic (`navigator.getBattery`) prefers low-power when unplugged and <=20%; default is high-performance.
  - Adapter identity comes from the synchronous `adapter.info` (SSOT); the deprecated `requestAdapterInfo()` is not used.
- **Limit probing**: renderer checks required adapter limits (always `maxTextureDimension2D >= 4096`; compute weather additionally requires storage-buffer minima) and **hard-fails** the boot probe with a descriptive reason (no WebGL weather rescue).
- **Compute smoke**: after device + canvas configure, a tiny `@compute` pipeline is created so Edge/Chrome shader-backend gaps fail the probe instead of mounting a broken weather session.
- **Labels**: the device, its default queue, and the swap-chain configuration carry `streetview-device` / `streetview-queue` / `streetview-swapchain` (`DEVICE_LABELS`) so PIX, RenderDoc and `about:gpu` traces are readable.
- **Canvas configure** is a policy (`resolveCanvasOutputPolicy` + `buildCanvasConfiguration` in `deviceInit.ts`), not four literals. The default boot is unchanged and pixel-identical to the historical SDR swap-chain:
  - `format: navigator.gpu.getPreferredCanvasFormat()`
  - `alphaMode: 'opaque'`
  - `colorSpace: 'srgb'`
  - `usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC` — **`COPY_SRC` must never be dropped**; cinema clip capture and snapshots depend on it.
  - `?hdr=1` => `format: 'rgba16float'` + `toneMapping: { mode: 'extended' }` (Chrome 123+). No optional feature is needed — an `rgba16float` canvas is core WebGPU (it used to be gated on `float32-filterable`, which no HDR path reads and which most mobile adapters lack). Whether the browser honours it is decided by the configure itself: a rejected descriptor falls back to SDR (below). Extended tone mapping is what stops the HDR intermediate being crushed to 8-bit at the display. Output-referred only — the weather uniform layout stays 44 floats.

    When the **applied** tone mapping is `extended` (never the requested flag — a rejected configure falls back to SDR and `bootDevice` rewrites the policy from `appliedCanvas`), both weather shaders are assembled with an output-referred `aces_tonemap` instead of the SDR one (`assembleExtendedToneMappingShader` in `shaderFeatureVariants.ts`). The ACES shoulder is evaluated against `EXTENDED_TONEMAP_HEADROOM` (4.0, SDR-relative) rather than assuming SDR white is the peak, so sun flare and headlights land in display headroom instead of clamping flat at 1.0. At headroom 1.0 the body is algebraically the SDR one. **No new uniform slot, no layout change** — the swap is a pipeline-create-time source substitution, the same mechanism as the subgroup and dual-source variants, and `npm run validate:shaders` naga-checks both assembled variants. Default SDR boot compiles the byte-identical historical shader; `shaderFeatureUses.extendedToneMapping` on the capability matrix says which ran.
  - `?p3=1` => `colorSpace: 'display-p3'`. `?p3=auto` follows `matchMedia('(color-gamut: p3)')`; `?hdr=auto` follows `matchMedia('(dynamic-range: high)')`. Both flags default to `off`, so nothing changes without an explicit opt-in.
  - `viewFormats` stays `[]` on HDR configure — there is no GPU UI overlay sampling an sRGB view of the swap-chain.
  - If the browser rejects the requested descriptor, the renderer re-configures as SDR sRGB, records `canvasDowngradeReason` on the capability matrix, and uses the applied format as its presentation format.
- **Uncaptured errors**: `device.addEventListener('uncapturederror')` counts errors onto `capabilityMatrix.uncapturedErrorCount` / `lastUncapturedError`, logs them, and surfaces them on the backend chip. This is separate from the `device.lost` promise so the two paths never double-dispose.
- **Device loss path**: on `device.lost`, renderer stops rendering, tears down GPU resources, calls `context.unconfigure()`, and reports the loss to `WebGPUCanvas.tsx`, which re-inits through `DeviceLossRecovery` (`renderer/deviceLossRecovery.ts`): at most 3 attempts per incident with exponential backoff (0.5 s, 1 s, 2 s), then a terminal "GPU unavailable" overlay. A loss the renderer **caused** is never reported: `Renderer.destroy()` (and `bootDevice` on its own post-device failure paths) marks the teardown as intended first, so a failed boot can no longer loop destroy → lost → re-init → fail. A `destroy()` from anywhere else is treated as a genuine loss. The canvas context is acquired before `requestDevice`, and every failure after the device exists destroys it.
- **Validation-safe pipelines**: every shader module and pipeline is built through `renderer/gpuPipelineFactory.ts` — `getCompilationInfo()` errors (logged as `file:line:col`), `create*PipelineAsync` rejections, and validation error scopes all become promise rejections instead of invalid objects that poison the frame's command buffer. `gpuObjectLabels.test.ts` forbids direct `createShaderModule` / `create*Pipeline` calls and unlabeled ones. Error scopes are one stack per device and pass inits run concurrently, so a scope is never held open across an `await`.
- **Pass isolation** (`renderer/framePasses/`): the frame is an ordered registry — `streetview` (100, required) → `historical-wipe` (200) → `weather` (300) | `present-fallback` (310) → `cabin-composite` (400). All passes initialise concurrently; each ends `ready` or `failed(reason, compilation)` on `window.webgpuProbe.passes`, and only ready + enabled passes are encoded. A failed optional pass is skipped (the cabin falls back to the CSS overlay + 2D latch, the wipe to the crossfade); a failed `weather` pass is replaced by `PresentFallbackPostProcessor` (pass 1 → ACES → swap chain, inline WGSL) so the road frame still presents; a failed `streetview` pass fails boot at probe stage `pipeline`. A new pass is a file plus a `registry.register(...)`, with its **own** uniform buffer — the weather layout does not grow.
- **Canvas backing store**: `components/canvasBackingStore.ts` sizes the canvas to CSS × DPR from a `ResizeObserver` (`devicePixelContentBoxSize` where it agrees with CSS × DPR, else `contentBoxSize × devicePixelRatio`; a `(resolution)` media query catches DPR-only changes), capped by the quality tier's `pixelRatio` (never below 1) and clamped to `device.limits.maxTextureDimension2D`. The device requests `min(adapter.maxTextureDimension2D, 8192)` rather than the 4096 floor, and `TextureLifecycle` clamps the intermediate and downscales an oversize Maps canvas into the largest texture that fits.
- **Live upload readback**: the canvas stability fingerprint (`drawImage` + `getImageData` of the Maps canvas) runs only while a source is unproven, after a source or size change, and at 1 Hz — never per frame.
- **Adapter probe surface**: a summarized adapter record is logged once and exposed at `window.rendererAdapterInfo` for diagnostics.
- **One device only**: `adapter.requestDevice()` is called in exactly one place (`renderer/bootDevice.ts`, reached only from `Renderer.init()`); chores and weather share that device. Enforced by `deviceInit.test.ts`. After a failed boot probe, `#216` chores must use `isWebGpuProbeOk()` / WASM-JS and must **not** call `requestDevice` again.

## In-App Control

All of the above is also reachable without DevTools: a small `WebGPU` / `WebGPU failed (Chrome|Edge|…)` chip is pinned to the bottom-left corner whenever backend info is available (including hard-fail). Clicking it expands a panel with a WebGPU button and a **disabled** “WebGL2 (reference)” control. On success the panel shows the capability-matrix diagnostics (including optional-feature counts; `?gpu=features` dumps attempted/enabled JSON). On hard-fail it shows `webgpuProbe` brand / stage / adapter / reason. The chip is a thin UI wrapper — `window.webgpuProbe` and `window.streetViewRendererDebug` remain the scripting surfaces.

## Effect Isolation

Effect isolation and wireframe remain URL/debug flags on the **live WebGPU** path (`RendererDebugOptions`). The retired GLSL reference still contains the same isolation branches for must-match tests.

```text
?effect=raw
?effect=color
?effect=weather
?effect=fog
?effect=night
?effect=lighting
?wireframe
```

At runtime:

```js
window.streetViewRendererDebug.setEffectIsolation('weather');
window.streetViewRendererDebug.setWireframe(true);
window.streetViewRendererDebug.getDebugOptions();
```

The isolation value is stored in `localStorage` as `streetview.effect`. `wireframe` is a screen-space UV/grid overlay because the Street View renderer is a fullscreen pass, not a mesh renderer.

### `?effect=weather` visual checklist (epic #171)

Use this when changing rain/snow particle math in `weather-post.wgsl`, `weather-post-compute.wgsl`, or the GLSL reference `src/renderer/webgl/weatherReference.glsl.ts`:

1. Raise snow (and rain) intensity above 0 in the Weather panel.
2. **WebGPU default** — flakes/streaks must fall **downward** (top-origin UV; `st.y - t * …`).
3. **GLSL reference** — same downward direction. The vertex shader flips `vUv.y` to top-origin; particle Y time terms must stay **negative** (`WEATHER_FALL_Y_SIGN = -1` in `src/car/carSpatialModel.ts`). Locked by `webglLookParity.test.ts`.
4. Optional: **`?weather=compute`** on WebGPU — match fragment fall direction.
5. **WebGPU night preset** — road readable with headlights; not crushed black. Floors live in `carSpatialModel.ts` (`NIGHT_BASE_FLOOR` / `NIGHT_SKY_FLOOR`).

## Weather Post-Process: Fragment vs Compute

The WebGPU backend's second pass (weather rain/snow/fog/color grading) has two implementations that render the same effects from the same 44-float parameter layout:

- **Fragment** (default): `src/renderer/WeatherPostProcessor.ts` + `public/shaders/weather-post.wgsl`. A single fullscreen-triangle render pass sampling the HDR intermediate texture.
- **Compute**: `src/renderer/ComputeWeatherPostProcessor.ts` + `public/shaders/weather-post-compute.wgsl`. A compute pass (`@workgroup_size(16, 16, 1)`) writes into an `rgba32float` storage texture, followed by a cheap `textureLoad` blit render pass to the canvas. It exposes `image_video_effects`-compatible bindings for depth textures, data textures, and a `plasmaBuffer` storage array. Live resources: `writeDepthTexture` / `readDepthTexture` (bindings 6/4, view-depth ping-pong), `plasmaBuffer` (binding 12, WASM fBm tile), and — when GPU particles are on — `dataTextureA/B` (bindings 7/8, density splat + particle state). `dataTextureC` stays a 1x1 dummy. Integrate/splat live in `public/shaders/weather-particles.wgsl`.

Both read the same `44-float` weather parameter layout, defined once in `src/renderer/weatherUniformLayout.ts` (`WeatherParamIndex`) and mirrored in both WGSL files' comments — see "Shader Uniform Layouts" in `AGENTS.md`.

The one intentional difference is the *contents* of the CPU noise tile: the fragment path is fed a single Perlin octave (`fill_noise_buffer`) so its default look is unchanged, while the compute path gets a 4-octave fBm tile (`fill_fbm_buffer`). `WebGPUCanvas` selects this from `renderer.getWeatherPostProcessMode()`. The bilinear sampler itself is identical in both shaders and guarded by `weatherShaderParity.test.ts`; see `docs/WASM_BRIDGE.md`.

Select the pipeline with:

```text
?weather=compute
?weather=fragment
```

or persist a choice from DevTools:

```js
window.streetViewRendererDebug.setWeatherMode('compute');
window.streetViewRendererDebug.setWeatherMode('fragment');
window.streetViewRendererDebug.getWeatherMode();
```

Like `setBackend`, `setWeatherMode` persists to `localStorage` (`streetview.weatherMode`) and reloads the page. With no explicit URL flag or stored preference, the mode falls back to the detected visual quality preset's `weatherPostProcessMode` (`src/config/visualPresets.ts`): **Low and Medium default to `'fragment'`; High and Ultra default to `'compute'`.** High budgets 2000 particles, which only the compute path can allocate.

### High → fragment: the one-step degrade

Compute weather raises the required adapter limits (`checkRequiredLimits`), so a High-preset boot can fail the limit gate on an adapter that would have run fragment weather fine (Intel iGPUs are the case in point). `createStreetViewRenderer` re-boots **once** on fragment weather when, and only when, all of:

- the first boot failed at `webgpuProbe.stage === 'limits'`, and
- the compute mode came from the quality **preset** — `getWeatherPostProcessModePolicy().source === 'preset'`.

An explicit `?weather=compute` or a stored `streetview.weatherMode = 'compute'` is never second-guessed: it still hard-fails, because an explicit request that silently runs something else is a lie about the pipeline. The degrade is likewise never silent — it is published on `window.webgpuProbe.weatherDegrade` as `{ from, to, reason }`, and a failing fragment retry hard-fails rather than degrading a second time.

GPU particles follow the mode, not the degrade: after a degrade the boot is on fragment weather, so `isParticlePrecipitationEnabled` is false. Low and Medium never allocate the particle textures even under a forced `?weather=compute`.

**This is WebGPU-only.** There is no live WebGL2 weather session. `?weather=compute` selects the compute WGSL path; the GLSL reference is fragment-only SDR.

Rain, snow, fog, color grading, night/headlight lighting, astronomical effects, WASM dust turbulence, and the cinematic camera FX are at parity between the two WGSL paths; shared helper bodies are enforced identical by `src/renderer/weatherShaderParity.test.ts`. The compute path **adds** a WASM-seeded GPU particle layer (bindings 7/8) on top of the shared procedural rain/snow; the fragment path does not.

Compute binding still backed by a 1x1 dummy: `dataTextureC`. Binding 4/6 are a full-res **depth ping-pong** pair. Bindings 7/8 are a half-res density splat + compact particle-state grid when GPU particles are enabled (High/Ultra compute weather). See `docs/GRAPHICS.md` §5.

## Capability matrix (WebGPU device init)

Enforced in `src/renderer/deviceInit.ts` and exposed on `window.rendererAdapterInfo` after init.

| Surface | Policy | Notes |
| --- | --- | --- |
| `float32-filterable` | Requested when adapter exposes it | Compute weather storage reads. No longer gates `?hdr` |
| `maxTextureDimension2D` | `min(adapter, 8192)`; boot fails below 4096 | The canvas backing store (CSS × DPR) and the Maps canvas upload are clamped to it |
| `timestamp-query` | Requested when adapter exposes it | **Used:** GPU pass timings in the performance overlay (P), via `timestampWrites` on the render/compute pass descriptor |
| `timestamp-query-inside-passes` | **Not requested** | No shipping browser exposes this name (Chromium's is `chromium-experimental-timestamp-query-inside-passes`), so requesting it never enabled anything. `GpuPassTimer` keeps its `'inside-passes'` branch for a device that does expose it. |
| `timestampWriteStrategy` | `'pass-descriptor'` / `'inside-passes'` / `'none'` | Which stamping path `GpuPassTimer` actually took this boot |
| `subgroups` | Requested when adapter exposes it | **Used:** gpu-chores hist coalesced atomics (`gpu-chores-hist-subgroups.wgsl`) and compute-weather luma firefly reduce (`withSubgroupLumaReduce`). Scalar fallbacks stay naga-clean. `?gpu=compat` does not require the feature. |
| `shader-f16` | **Not requested** | **Unused in production WGSL**, so it is no longer requested (an enabled-but-unused feature only narrows the adapters a re-init can land on). `scripts/f16-naga-spike.wgsl` is the probe; naga-cli is installed unpinned in CI and newer builds now accept `enable f16`, so the guard in `validateShaders.test.ts` asserts the shipped state (no `enable f16;` in production WGSL, `shaderFeatureUses.shaderF16` false) rather than a validator version. Flipping it needs a production shader that actually uses `f16`. |
| `rg11b10ufloat-renderable` | Requested when adapter exposes it | **Used:** Pass-1 HDR intermediate is `rg11b10ufloat` when enabled and alpha is unused; otherwise `rgba16float`. Recorded as `capabilityMatrix.intermediateFormat`. |
| `dual-source-blending` | Requested when adapter exposes it | **Used:** fragment weather `fs_main` outputs precip as `@second_blend_source` (`assembleDualSourceWeatherShader`). In-shader `col + precipAdd` remains the naga-clean fallback. |
| `clip-distances` | Requested when adapter exposes it; `?no_clip_distances` leaves it out | **Used:** gates the cabin's windshield portal — three emits the portal's aperture planes as hardware clip distances (no fragment `discard`). Without it the glass keeps today's hole + decal overlay. See § Windshield portal |
| `core-features-and-limits` | Requested when adapter exposes it **and** not `?gpu=compat` | Must not undo compatibility mode |
| `optionalFeaturesAttempted` / `Enabled` | Attempted = `OPTIONAL_FEATURES_ATTEMPTED`; enabled = `requestDevice` list | Chip count; `?gpu=features` dumps JSON including `intermediateFormat` and `shaderFeatureUses` |
| `intermediateFormat` | `rgba16float` (default) or `rg11b10ufloat` | Packed format only when `rg11b10ufloat-renderable` is enabled |
| `maxTextureDimension2D` | Required ≥ 4096 | Panorama + HDR intermediate |
| `maxStorageBufferBindingSize` / `maxBufferSize` | Required ≥ 65536 when `?weather=compute` | WASM noise tile + particle buffer headroom |
| `maxComputeWorkgroupSizeX/Y` | Required ≥ 16 when compute weather; ≥ 8 (and 64 invocations) added on fragment boots only when the adapter has them | Weather `@workgroup_size(16,16,1)`; chores `@workgroup_size(8,8,1)` never fail boot |
| Sampler `maxAnisotropy` | Low=1, Medium=2, High=4, Ultra=8 | Clamped to `device.limits.maxAnisotropy`; fragment path only |
| `featureLevel` | `'core'` (default) / `'compatibility'` (`?gpu=compat`) / `'unknown'` | `'unknown'` when the browser has no `featureLevel` field |
| `forceFallbackAdapter` | `true` only for `?gpu=fallback` | Software adapter for CI and probe runs |
| `canvasFormat` | Preferred canvas format, or `rgba16float` under `?hdr=1` | Pipelines follow whatever configure actually applied |
| `canvasColorSpace` | `'srgb'` (default) / `'display-p3'` (`?p3=1`) | |
| `canvasToneMapping` | `'standard'` (default) / `'extended'` (`?hdr=1`) | Drives the output-referred `aces_tonemap` swap; mirrored as `shaderFeatureUses.extendedToneMapping` |
| `viewFormats` | `[]` today | Reserved for future sRGB-variant views |
| `canvasDowngradeReason` | Set when an HDR/P3 configure was rejected | Renderer re-configures SDR sRGB and keeps going |
| `uncapturedErrorCount` / `lastUncapturedError` | Counted from `uncapturederror` | Shown on the backend chip |
| `gpuChoresWorkgroupSize` | Always `8` | `#216` hist/downsample `@workgroup_size(8,8,1)` — independent of weather 16×16 |
| `gpuChoresKillSwitch` | `true` when `?no_gpu_compute` | Chores fall back to WASM/JS; **weather fragment/compute is unchanged** |
| `gpuChoresGpuEligible` / `gpuChoresIneligibleReason` | `false` + the limit when `maxComputeWorkgroupSizeX/Y < 8` or `maxComputeInvocationsPerWorkgroup < 64` | `GpuChores` skips GPU init (WASM/JS) without setting the kill switch; pipeline-create `catch` stays as a second guard |

GPU timings (when `timestamp-query` is enabled) are published on `window.rendererGpuTimings` and shown in **Performance Stats** (press P): Pass1 (panorama → HDR), weather (fragment or compute), and blit (compute only).

### How spans are stamped

`src/renderer/gpuPassTimer.ts` declares each span on the pass descriptor — `timestampWrites: { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex }` on `beginRenderPass` / `beginComputePass` — rather than calling the deprecated `GPUCommandEncoder.writeTimestamp` / pass-encoder `writeTimestamp`. Slot map: 0/1 pass 1, 2/3 weather, 4/5 the compute blit.

`GpuPassTimer` probes the device once at construction (a dropped, never-submitted encoder) and records the result as `capabilityMatrix.timestampWriteStrategy`:

| Strategy | When | Browsers |
| --- | --- | --- |
| `'pass-descriptor'` | `timestamp-query` enabled and the descriptor probe is accepted | Chrome / Edge 121+, Firefox Nightly, Safari TP — i.e. everything that ships `timestamp-query` today |
| `'inside-passes'` | The descriptor probe throws **and** `timestamp-query-inside-passes` is enabled | Legacy-only implementations that still expose pass-encoder `writeTimestamp` |
| `'none'` | No `timestamp-query`, or neither path is usable | SwiftShader, CI smoke, `?gpu=fallback` |

On `'none'` every entry point is a no-op, the query set is never resolved, and the overlay reads `available: false`. `markPassStart` / `markPassEnd` are no-ops except on `'inside-passes'`; nothing calls encoder-level `writeTimestamp` any more. `timestamp-query-inside-passes` is no longer requested (see the capability matrix), so `'inside-passes'` is only reachable on a device that enables it some other way.

Timestamps are only written while the performance overlay (P) is open (`setGpuPassTimingsWanted` in `gpuPassTimingStore.ts`, driven by `useAppTelemetry`): with it closed the frame loop passes no timer, so there is no per-frame resolve, copy or `mapAsync`. Slots are assigned per pass id (`TIMESTAMP_SLOTS` in `frameLoop.ts`); `present-fallback` shares the weather span.

## gpu-chores (panorama analysis, #216)

Histogram / downsample / reduce for gauges, snapshot picker thumbs, and an auto-exposure **hint**. This is **not** another weather physics pass and must not share bind groups with `weather-post-compute.wgsl`.

- Jobs: `luma_histogram_bt709` (256-bin Rec.709, 1/4-res samples), `downsample_2d` (integer box filter), `reduce` (mean/min/max luma).
- Backend order: WebGPU compute on the **shared Renderer `GPUDevice`** → WASM → JS. No second `requestDevice`. Chrome **or** Edge probe failure (`webgpuProbe.ok === false`) degrades chores to WASM without tearing down weather.
- Kill switch: `?no_gpu_compute` (bare / `=1` / `true`). Does **not** force `?weather=compute` off. Rain still draws on the fragment path with chores disabled.
- Breadcrumbs: `window.__GPU_CHORES__` (`backend`, `killSwitch`, `jobs`, last mean/min/max/ms) and `window.streetViewRendererDebug.getGpuChores()`.
- Consumers: Performance Stats **Scene luma** gauge (incl. AE EV hint; does not mutate the exposure slider) and snapshot gallery thumbs via `downsample_2d`.
- Goldens: `cpp/tests/goldens.json` / `goldens_generated.h` (`luma_histogram_bt709`, `reduce_luma_bt709`, `downsample_2d`). GPU vs WASM is a gauge signal when an adapter exists; jsdom has no GPU.

Workgroups are `(8,8)`. Do not spin a second GL context on the panorama working set for histograms.

WGSL compile validation: `npm run validate:shaders` (requires `naga` CLI — CI installs via `cargo install naga-cli`).

## Parity Notes

Live weather is WebGPU fragment vs compute. The GLSL in `src/renderer/webgl/weatherReference.glsl.ts` is an SDR **reference** (not constructed at runtime) used by `webglLookParity.test.ts` for must-match literals.

Current parity:

- Shared source: Google Maps panorama canvas.
- Shared controls: color grading, rain, snow, wind, fog, night intensity, headlights, dome light, sun/moon camera-aware lighting.
- Shared camera state: heading, pitch, and zoom.
- Boot chain: WebGPU probe → ready **or** hard-fail (no GL weather session).
- Shared browser breadcrumbs (`webgpuProbe`, renderer globals) for Playwright and manual debugging.

Known differences (GLSL reference vs live WGSL):

- WebGPU keeps the HDR two-pass `rgba16float` path; the GLSL reference is a single-pass SDR approximation.
- WebGPU transition snapshots use GPU textures. CPU `transitionSource` is diagnostics-only now.
- Some atmospheric effects in `weather-post.wgsl` are simplified in GLSL.

### Backend parity checklist (debug matrix)

| Effect | Budget | WebGPU fragment | WebGPU compute | GLSL reference |
| --- | --- | --- | --- | --- |
| Rain direction | **must match** | Downward | Downward | Downward |
| Snow direction | **must match** | Downward | Downward | Downward |
| Night readability | **must match** | Road/UI readable with headlights | Same target as fragment | Approximate, same readability target |
| Overcast sun kill | **must match** | CPU `weatherCohesion` | Same CPU pack | Same CPU pack (shaft/flare uniforms) |
| Rain darken `mix(0.22, 0.10)` | **must match** | Yes | Yes | Yes (was 0.045/0.020) |
| Humidity haze mix | **must match** | Distance + color + 4-tap blur | Same mix, `textureSampleLevel` blur | Distance + color mix, no blur |
| Fog/headlights controls | best effort | Full | Full | Approximate |
| fBm / WASM dust | skip | Fragment Perlin tile | fBm tile | None |
| DOF / motion blur | skip | High / Ultra, reduced-motion gated | Same | Ignores slots 38/39 |
| GPU particles | skip | No | High/Ultra compute | No |

`src/renderer/weatherShaderParity.test.ts` is a CI guard for WGSL drift: it compares `applyNight` and normalized `snow(...)` math between `weather-post.wgsl` and `weather-post-compute.wgsl` and fails if they diverge. `src/renderer/webglLookParity.test.ts` locks the must-match GLSL literals (rain darken, haze color, fall Y).

## GLSL reference notes

The retired WebGL2 weather class is gone from the runtime module graph. When must-match atmosphere literals change:

1. Keep parameter indices aligned with the 44-float weather layout in `src/renderer/weatherUniformLayout.ts`, `packWeatherParams.ts`, both weather processors, both WGSL files, and `WebGPUCanvas.tsx`.
2. Update `uWeather[...]` reads in `src/renderer/webgl/weatherReference.glsl.ts` so `webglLookParity.test.ts` still passes.
3. Route debug isolation through `RendererDebugOptions` on WebGPU.

## Changing weather uniforms

The live WebGPU paths (fragment + compute) must stay lockstep on the same 44-float layout. When adding, renaming, or reordering a weather parameter:

1. Update `WeatherParamIndex` and `WEATHER_PARAMS_FLOAT_COUNT` in `src/renderer/weatherUniformLayout.ts`.
2. Update `packWeatherParams` / `createDefaultWeatherParams` in `src/renderer/packWeatherParams.ts`.
3. Update both WGSL headers and accessors: `public/shaders/weather-post.wgsl` (`struct WeatherParams`) and `public/shaders/weather-post-compute.wgsl` (`extraBuffer` comment + `p_*` helpers).
4. Confirm both `WeatherPostProcessor` and `ComputeWeatherPostProcessor` still satisfy the exported `WeatherPostProcessorLike` interface (`src/renderer/weatherPostProcessorTypes.ts`).
5. Update GLSL `uWeather[...]` reads in `src/renderer/webgl/weatherReference.glsl.ts` when must-match literals are involved.
6. Update the hard-assert name→index table in `src/renderer/weatherUniformLayout.test.ts` and packing fixtures in `packWeatherParams.test.ts`.
7. Run `CI=true npm test -- --watchAll=false` (these suites do not require a real GPU).
