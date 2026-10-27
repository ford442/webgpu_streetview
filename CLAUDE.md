# Claude quick reference

**Source of truth:** [`AGENTS.md`](./AGENTS.md) — architecture, danger zones, build/test/deploy, and agent workflows.

This file is a short pointer so Claude Code sessions land on the right doc without duplicating content.

## Start here

1. Read `AGENTS.md` (project map, hotspots, testing strategy).
2. For human-facing setup: `README.md`.
3. For deep graphics pipeline: `docs/DEVELOPER_CONTEXT.md`, `docs/RENDERER_FALLBACK.md`.
4. For billable APIs (rearview Static feed): `BILLING_SAFETY_CHECKLIST.md`.

## Critical danger zones (do not skip)

- **Canvas scraping** (`src/components/StreetView.tsx`) — opacity must stay `1`; recovery is continuous.
- **Hold-pause** (`Renderer.ts`, `WebGPUCanvas.tsx`, `useStreetView.tsx`) — never upload live GMaps canvas while `holdActive`; use `window.__STREETVIEW_PROBE__`.
- **Input hijacking** — UI overlays must `stopPropagation` on mouse/keyboard events.
- **Maps API keys / secrets** — runtime `public/config.js` / deploy `MAPS_API_KEY`; referrer allowlist per host. Only `scripts/public-env-keys.json` keys are inlined into the bundle; never track `.env*` (only `*.example`); `git.sh` requires a message and stages tracked files only (gitleaks runs in CI).
- **Hot POV state** — `heading`/`pitch`/`zoom`/`carHeading` live in `src/state/povStore.ts`, not React context; do not put them (or anything per-frame) in a provider value. `AppShell.renders.test.tsx` enforces it.
- **Cabin transforms** — the cabin scene is the car's frame: `interiorGroup` (car rig) stays at identity rotation; `headPivot` → camera carry only the car-local head pose (`cabinHeadStore`, radians, +yaw = left). Never rotate the rig with `carHeading`/look, never feed a world heading to the camera (it is parented — that double-counts `carHeading`). Street View POV is derived once per frame in `car/input/cabinPovSync.ts`; cabin FOV comes from `utils/streetViewFov.ts`. Modes: `car/input/cabinInputMachine.ts` (pointer lock; Esc via `pointerlockchange` only).
- **URL flags** — add them to `src/config/flags.ts` (then `npm run gen:flags-doc`); never parse `location.search` anywhere else.
- **Shader uniform layout** — `src/renderer/weatherUniformLayout.ts` must match both weather WGSL passes. Shader *variants* (subgroups, dual-source precip, the `?hdr` output-referred grade) are source substitutions at pipeline-create time in `shaderFeatureVariants.ts` — keep their literal bodies byte-identical to the shipped `.wgsl`. Slots 40–41 are the image-derived horizon (`renderer/gpuChores/horizonEstimate.ts`, preset weight `horizonEstimateBlend`); every effect reads it through `sceneHorizonY()`, and blend 0 is bit-exact with the pitch-only horizon.
- **One-frame compositor** — the default WebGPU cabin renders into a `GPUTexture` (`car/interior/cabinFrameTarget.ts`) that `renderer/cabinComposite.ts` draws over the swap chain. `renderer/cabinOverlayRegistry.ts` must stay a single module instance across chunks; cinema/snapshots skip the 2D latch only when `isCabinCompositedInFrame()` is true.
- **Render scale** (`renderer/renderScale.ts`, `frameBudget.ts`, `upscale/`; `docs/GRAPHICS.md` §7) — never skip a frame to keep up; the road's render scale is the lever. Weather must render at the intermediate's size (its UV is `fragCoord / textureDimensions`), so below 1 it writes the upscale's road target and the lazy `upscale` pass presents it; at scale 1 neither is built or encoded and the frame is bit-exact with no scaling. The scale is frozen while `holdActive`. The windshield portal samples the scaled intermediate, never the upscaled output.
- **Windshield portal** — the WebGPU cabin's wet glass (`WindowWeatherOverlay` → `WindshieldPortal`) samples the road's pass-1 HDR intermediate through `renderer/roadFrameRegistry.ts` (single module instance; intermediate only — never the Maps canvas, `videoTexture`, or the rear feed). The road owns that texture: `car/interior/roadFrameBinding.ts` must keep `neuterDestroy` and a new `ExternalTexture` wrapper per texture identity. `createRoadDisplay` mirrors `weather-post`'s look — change `fs_main`'s colour path and update it (`windshieldPortal.parity.test.ts`, `e2e/windshield-portal.spec.ts`). Gated on `clip-distances`; `?portal=off` / `?no_clip_distances` / `?cabin=webgl` fall back to hole + decal.
- **GPU passes** — create shader modules / pipelines only through `renderer/gpuPipelineFactory.ts` (validation errors reject instead of yielding invalid objects; `gpuObjectLabels.test.ts` enforces it, labels required). A new frame pass is a `FramePass` registered in `renderer/framePasses/` with its own uniform buffer; failed optional passes are skipped and reported on `webgpuProbe.passes`. Never hold an error scope open across an `await` (one stack per device, inits run concurrently). The renderer must not report a device loss it caused (`teardownIntended`).
- **Routed road trips** — on-route cruise hops make **zero** extra Maps calls (no target hint / prefetch in `routeHop`; `useCruiseMode.route.test.tsx`). Every `getPanorama` call site goes through `services/maps/callBudget.ts`. `tripStore` is an external store, not context. Routes come from `ROUTING_ENDPOINT` (OSRM-compatible), never Google Directions without a `BILLING_SAFETY_CHECKLIST.md` row. Offline trips (`docs/ROAD_TRIPS.md`): the prefetch and replay are the metered ones (`trip-prefetch`, `replay` — one lookup per pano); the offline planner and the recorder make none; nothing stores imagery.
- **Scene depth** (`renderer/depth/`, `docs/SCENE_DEPTH.md`) — input is the pass-1 intermediate only (never the Maps canvas, never during `holdActive`); onnxruntime-web is CDN-imported inside the depth Worker (never an npm dep or in the bundle — `depthBundleGuard.test.ts`); the Worker's device is the one `requestDevice` besides `bootDevice.ts`. Depth weight 0 must stay bit-exact: keep the early-return / verbatim branches in `sceneDepth`, `rain`, `snow`, `samplePrevForRelease`. Model files are deploy-time (`npm run fetch:depth-model`), Apache-2.0 Small only — never Base/Large (CC-BY-NC).
- **WASM numeric layer** — algorithms live in `cpp/src/*_module.cpp` (one translation unit per domain: noise, geodesy, audio, hrtf, luma, cabin dsp, depth, link graph) — the **only** implementation: no JS twin, Vitest runs the committed binary (`setupTests.ts`), call sites use `requireWasm()`, and a failed load fails the boot at `webgpuProbe` stage `wasm` — and ship via emcc (`npm run build:wasm`) as two binaries from one source list: scalar and `streetview-wasm.simd.wasm` (both must reproduce the goldens bit for bit — keep the FIR's four-lane summation order). Changing the C++ means regenerating `cpp/tests/goldens*` (`npm run gen:wasm-goldens`) and re-running `npm run test:cpp`. A new `.cpp` must be added to both CMake source lists, `scripts/lint-cpp.sh` and `scripts/wasm-source-hash.mjs`. Kernel pointers come from the loader's malloc'd scratch arena (`src/wasm/marshal.ts`) — never a fixed offset (64 KiB overlapped the stack). `-s STACK_SIZE` must equal `WASM_STACK_SIZE` (the loader asserts it); clang-tidy gates on `bugprone-*`. `build-wasm.sh` refuses any emcc but `cpp/emsdk.version`.
- **Split frame / WebXR** (#331) — the frame tail (`renderer/reproject/`) exists only with `?latelatch`, `?stereo` or an XR session; without them the frame must stay the pre-#331 frame, and latch delta 0 is a `textureLoad` copy (bit-exact). The tail waits for the car loop's `frameTailScheduler.producerDone(frameTime)`. WebXR uses the one device (`xrCompatible` via `bootDevice.ts` only — no second `requestDevice`, no WebGL XR, no three `WebXRManager`); app frame loops schedule through `xr/frameClock.ts`, never raw `requestAnimationFrame`, so they run inside the XR callback where the sub-images are valid. Headset pose → `cabinHeadStore` + `cabinHeadOffsetStore` (the rig never moves); the stick steers only through `XR_STICK` rows in `CABIN_INPUT_TRANSITIONS`. `renderer/xrPresentFrame.ts` and `cabinStereoRequest.ts` stay single module instances.
- **Cabin audio** — the WASM engine (`cabin_dsp_module.cpp`) renders the whole bed + radio inside the AudioWorklet; the main thread posts only `params`/`ir`, never PCM. Post the binary's bytes to the worklet, never a `WebAssembly.Module` (Chromium: `messageerror`, silently dropped). The car radio joins `audio/carAudioGraph.ts`'s shared context; `WindAudio` stays off while the engine runs. Probe: `window.__CABIN_AUDIO_PROBE__` (not `__STREETVIEW_PROBE__`).

## Commands

```bash
npm ci          # clean install
npm start       # dev server :3000
npm run verify  # THE gate: typecheck + lint + knip + secrets + tests + WGSL + C++ goldens
npm test        # Vitest (node env by default; `// @vitest-environment jsdom` per file for DOM)
npm run typecheck   # tsc -b
npm run lint
npm run build
npm run test:cpp  # native C++ golden tests (needs cmake + a C++20 compiler)
```

_Last updated: dynamic render scale (#329) — budget loop, FSR 1.0 upscale, no frame skipping._
