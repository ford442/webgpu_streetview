# Renderer Fallback and Debugging

Street View post-processing now has two renderer backends:

- `webgpu`: the primary dual-pass renderer in `src/renderer/Renderer.ts`.
- `webgl`: the WebGL2 debug/reference renderer in `src/renderer/WebGLFallbackRenderer.ts`.

Both backends consume the same scraped Google Maps canvas, the same 40-float weather parameter layout, and the same normalized camera heading/pitch values from `WebGPUCanvas.tsx`. The Three.js car interior remains a separate transparent overlay above either backend.

## Backend Selection

Use URL flags:

```text
?renderer=webgpu
?renderer=webgl
?webgpu
?webgl
?legacyTransitions=1
```

`?renderer=webgl` tries WebGL2 first and falls back to WebGPU if WebGL2 cannot initialize. `?renderer=webgpu` tries WebGPU first and falls back to WebGL2 if WebGPU cannot initialize. With no flag, the app tries WebGPU first, then WebGL2, then the raw Street View DOM fallback.

The selected backend is exposed for browser automation and debugging:

```js
window.rendererType              // "webgpu" | "webgl"
window.usingWebGPU               // boolean
window.usingWebGL                // boolean
window.rendererFallbackReason    // string, empty when primary WebGPU is active
```

Persist a preference or change debug settings from DevTools:

```js
window.streetViewRendererDebug.setBackend('webgl');
window.streetViewRendererDebug.setBackend('webgpu');
window.streetViewRendererDebug.setBackend('auto');
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
  - `featureLevel` is only sent when the browser exposes the field (duck-typed via `GPUAdapter.prototype`), so older Chrome still boots with the historical request shape. When it is not sent, the capability matrix reports `featureLevel: 'unknown'`.
  - Otherwise, battery heuristic (`navigator.getBattery`) prefers low-power when unplugged and <=20%; default is high-performance.
  - Adapter identity comes from the synchronous `adapter.info` (SSOT); the deprecated `requestAdapterInfo()` is not used.
- **Limit probing**: renderer checks required adapter limits (always `maxTextureDimension2D >= 4096`; compute weather additionally requires storage-buffer minima) and fails soft to fallback with a descriptive reason.
- **Labels**: the device, its default queue, and the swap-chain configuration carry `streetview-device` / `streetview-queue` / `streetview-swapchain` (`DEVICE_LABELS`) so PIX, RenderDoc and `about:gpu` traces are readable.
- **Canvas configure** is a policy (`resolveCanvasOutputPolicy` + `buildCanvasConfiguration` in `deviceInit.ts`), not four literals. The default boot is unchanged and pixel-identical to the historical SDR swap-chain:
  - `format: navigator.gpu.getPreferredCanvasFormat()`
  - `alphaMode: 'opaque'`
  - `colorSpace: 'srgb'`
  - `usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC` — **`COPY_SRC` must never be dropped**; cinema clip capture and snapshots depend on it.
  - `?hdr=1` => `format: 'rgba16float'` + `toneMapping: { mode: 'extended' }` (Chrome 123+), gated on `float32-filterable` being enabled. Without that feature the request is soft-logged and the canvas stays SDR. Pass 2 still writes ACES; extended tone mapping is what stops the HDR intermediate being crushed to 8-bit at the display. Output-referred only — the weather uniform layout stays 40 floats.
  - `?p3=1` => `colorSpace: 'display-p3'`. `?p3=auto` follows `matchMedia('(color-gamut: p3)')`; `?hdr=auto` follows `matchMedia('(dynamic-range: high)')`. Both flags default to `off`, so nothing changes without an explicit opt-in.
  - If the browser rejects the requested descriptor, the renderer re-configures as SDR sRGB, records `canvasDowngradeReason` on the capability matrix, and uses the applied format as its presentation format.
- **Uncaptured errors**: `device.addEventListener('uncapturederror')` counts errors onto `capabilityMatrix.uncapturedErrorCount` / `lastUncapturedError`, logs them, and surfaces them on the backend chip. This is separate from the `device.lost` promise so the two paths never double-dispose.
- **Device loss path**: on `device.lost`, renderer stops rendering, tears down GPU resources, calls `context.unconfigure()`, and relies on `WebGPUCanvas.tsx` reinit (`reinitCounter`) to construct a fresh renderer instance.
- **Adapter probe surface**: a summarized adapter record is logged once and exposed at `window.rendererAdapterInfo` for diagnostics.
- **One device only**: `adapter.requestDevice()` is called in exactly one place (`Renderer.ts`); chores and weather share that device. Enforced by `deviceInit.test.ts`.

## In-App Control

All of the above is also reachable without DevTools: a small `WebGPU` / `WebGL2 (fallback)` / `Raw fallback` chip is pinned to the bottom-left corner of the app whenever a renderer is active, in both FreeLook and Car Mode (it sits above the Three.js car overlay, so it stays clickable while driving). Clicking it expands a panel with WebGPU/WebGL2 buttons — these just call `window.streetViewRendererDebug.setBackend(...)` under the hood, so switching backends still persists the choice to `localStorage` and reloads the page, same as the DevTools API. When the active backend is WebGPU, the panel also shows a read-only diagnostics block (feature level, canvas color space / tone mapping, uncaptured-error count and the latest message) read from `window.rendererAdapterInfo.capabilityMatrix`. When the active backend is WebGL2, the panel also exposes the effect-isolation dropdown and a wireframe checkbox described below; both apply live, with no reload, visible immediately through the car windows if you're in Car Mode. The chip is a thin UI wrapper, not a second source of truth — `window.streetViewRendererDebug` remains fully supported for scripting and automation.

## Effect Isolation

The WebGL2 fallback includes effect isolation for visual debugging:

```text
?renderer=webgl&effect=raw
?renderer=webgl&effect=color
?renderer=webgl&effect=weather
?renderer=webgl&effect=fog
?renderer=webgl&effect=night
?renderer=webgl&effect=lighting
?renderer=webgl&wireframe
```

At runtime:

```js
window.streetViewRendererDebug.setEffectIsolation('weather');
window.streetViewRendererDebug.setWireframe(true);
window.streetViewRendererDebug.getDebugOptions();
```

The isolation value is stored in `localStorage` as `streetview.effect`. `wireframe` is a screen-space UV/grid overlay because the Street View renderer is a fullscreen pass, not a mesh renderer.

### `?effect=weather` visual checklist (epic #171)

Use this when changing rain/snow particle math in `weather-post.wgsl`, `weather-post-compute.wgsl`, or `WebGLFallbackRenderer.ts`:

1. Raise snow (and rain) intensity above 0 in the Weather panel.
2. **WebGPU default** — flakes/streaks must fall **downward** (top-origin UV; `st.y - t * …`).
3. **`?renderer=webgl&effect=weather`** — same downward direction. The WebGL vertex shader flips `vUv.y` to top-origin; particle Y time terms must stay **negative** (`WEATHER_FALL_Y_SIGN = -1` in `src/car/carSpatialModel.ts`).
4. Optional: **`?weather=compute`** on WebGPU — match fragment fall direction.
5. **`?renderer=webgl&effect=night`** (and WebGPU night preset) — road readable with headlights; not crushed black. Floors live in `carSpatialModel.ts` (`NIGHT_BASE_FLOOR` / `NIGHT_SKY_FLOOR`).

## Weather Post-Process: Fragment vs Compute

The WebGPU backend's second pass (weather rain/snow/fog/color grading) has two implementations that render the same effects from the same 40-float parameter layout:

- **Fragment** (default): `src/renderer/WeatherPostProcessor.ts` + `public/shaders/weather-post.wgsl`. A single fullscreen-triangle render pass sampling the HDR intermediate texture.
- **Compute**: `src/renderer/ComputeWeatherPostProcessor.ts` + `public/shaders/weather-post-compute.wgsl`. A compute pass (`@workgroup_size(16, 16, 1)`) writes into an `rgba32float` storage texture, followed by a cheap `textureLoad` blit render pass to the canvas. It exposes `image_video_effects`-compatible bindings for depth textures, data textures, and a `plasmaBuffer` storage array. Live resources: `writeDepthTexture` / `readDepthTexture` (bindings 6/4, view-depth ping-pong), `plasmaBuffer` (binding 12, WASM fBm tile), and — when GPU particles are on — `dataTextureA/B` (bindings 7/8, density splat + particle state). `dataTextureC` stays a 1x1 dummy. Integrate/splat live in `public/shaders/weather-particles.wgsl`.

Both read the same `40-float` weather parameter layout, defined once in `src/renderer/weatherUniformLayout.ts` (`WeatherParamIndex`) and mirrored in both WGSL files' comments — see "Shader Uniform Layouts" in `AGENTS.md`.

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

Like `setBackend`, `setWeatherMode` persists to `localStorage` (`streetview.weatherMode`) and reloads the page. With no explicit URL flag or stored preference, the mode falls back to the detected visual quality preset's `weatherPostProcessMode` (`src/config/visualPresets.ts`) — every preset defaults to `'fragment'` except `ultra`, which defaults to `'compute'`.

**This is WebGPU-only.** The WebGL2 fallback renderer remains fragment-only (a single-pass SDR approximation) — there is no WebGL2 compute path, and `?weather=compute` has no effect when the WebGL2 backend is active.

Rain, snow, fog, color grading, night/headlight lighting, astronomical effects, WASM dust turbulence, and the cinematic camera FX are at parity between the two paths; shared helper bodies are enforced identical by `src/renderer/weatherShaderParity.test.ts`. The compute path **adds** a WASM-seeded GPU particle layer (bindings 7/8) on top of the shared procedural rain/snow; the fragment path and WebGL fallback do not.

Compute binding still backed by a 1x1 dummy: `dataTextureC`. Binding 4/6 are a full-res **depth ping-pong** pair. Bindings 7/8 are a half-res density splat + compact particle-state grid when GPU particles are enabled (High/Ultra compute weather). See `docs/GRAPHICS.md` §5.

## Capability matrix (WebGPU device init)

Enforced in `src/renderer/deviceInit.ts` and exposed on `window.rendererAdapterInfo` after init.

| Surface | Policy | Notes |
| --- | --- | --- |
| `float32-filterable` | Always requested when adapter exposes it | HDR intermediate + compute weather storage reads |
| `timestamp-query` | Opt-in when adapter exposes it | GPU pass timings in the performance overlay (P) |
| `maxTextureDimension2D` | Required ≥ 4096 | Panorama + HDR intermediate |
| `maxStorageBufferBindingSize` / `maxBufferSize` | Required ≥ 65536 when `?weather=compute` | WASM noise tile + particle buffer headroom |
| `maxComputeWorkgroupSizeX/Y` | Required ≥ 16 when compute weather | Matches `@workgroup_size(16,16,1)` |
| Sampler `maxAnisotropy` | Low=1, Medium=2, High=4, Ultra=8 | Clamped to `device.limits.maxAnisotropy`; fragment path only |
| `featureLevel` | `'core'` (default) / `'compatibility'` (`?gpu=compat`) / `'unknown'` | `'unknown'` when the browser has no `featureLevel` field |
| `forceFallbackAdapter` | `true` only for `?gpu=fallback` | Software adapter for CI and probe runs |
| `canvasFormat` | Preferred canvas format, or `rgba16float` under `?hdr=1` | Pipelines follow whatever configure actually applied |
| `canvasColorSpace` | `'srgb'` (default) / `'display-p3'` (`?p3=1`) | |
| `canvasToneMapping` | `'standard'` (default) / `'extended'` (`?hdr=1`) | |
| `viewFormats` | `[]` today | Reserved for future sRGB-variant views |
| `canvasDowngradeReason` | Set when an HDR/P3 configure was rejected | Renderer re-configures SDR sRGB and keeps going |
| `uncapturedErrorCount` / `lastUncapturedError` | Counted from `uncapturederror` | Shown on the backend chip |

GPU timings (when `timestamp-query` is enabled) are published on `window.rendererGpuTimings` and shown in **Performance Stats** (press P): Pass1 (panorama → HDR), weather (fragment or compute), and blit (compute only).

WGSL compile validation: `npm run validate:shaders` (requires `naga` CLI — CI installs via `cargo install naga-cli`).

## Parity Notes

The WebGL2 backend is intentionally approximate. It is meant for debugging panorama sampling, weather parameter wiring, color grading controls, and car overlay compositing in environments where WebGPU is unavailable or too opaque for automation.

Current parity:

- Shared source: Google Maps panorama canvas.
- Shared controls: color grading, rain, snow, wind, fog, night intensity, headlights, dome light, sun/moon camera-aware lighting.
- Shared camera state: heading, pitch, and zoom.
- Shared fallback chain: WebGPU -> WebGL2 -> raw Street View DOM.
- Shared browser breadcrumbs for Playwright and manual debugging.

Known differences:

- WebGPU keeps the HDR two-pass `rgba16float` path; WebGL2 applies an SDR single-pass approximation.
- WebGPU transition snapshots use GPU textures. WebGL2 relies on the existing CPU-side `transitionSource` supplied by `StreetViewProvider` and does not yet maintain its own previous-frame texture.
- Some atmospheric effects in `weather-post.wgsl` are simplified in GLSL to keep the fallback inspectable and robust.

### Backend parity checklist (debug matrix)

| Effect | Budget | WebGPU fragment | WebGPU compute | WebGL fallback |
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

## WebGL to WebGPU Porting Notes

When an effect is first debugged in WebGL2 and then ported to WGSL:

1. Keep parameter indices aligned with the 40-float weather layout in `src/renderer/weatherUniformLayout.ts`, `packWeatherParams.ts`, both weather processors (`WeatherPostProcessor.ts` / `ComputeWeatherPostProcessor.ts`), both WGSL files, `WebGPUCanvas.tsx` (caller), and `WebGLFallbackRenderer.ts`.
2. Add the WebGL branch as a readable approximation first, then port the exact math to WGSL after the control behavior is verified.
3. Preserve effect isolation where possible. If WGSL support is added, route it through the same `RendererDebugOptions` contract rather than adding backend-specific URL flags.
4. Treat WebGL screenshots as reference/debug evidence, not proof of HDR parity.

## Changing weather uniforms

The three post-process paths (fragment WebGPU, compute WebGPU, WebGL debug) must stay lockstep on the same 40-float layout. When adding, renaming, or reordering a weather parameter:

1. Update `WeatherParamIndex` and `WEATHER_PARAMS_FLOAT_COUNT` in `src/renderer/weatherUniformLayout.ts`.
2. Update `packWeatherParams` / `createDefaultWeatherParams` in `src/renderer/packWeatherParams.ts`.
3. Update both WGSL headers and accessors: `public/shaders/weather-post.wgsl` (`struct WeatherParams`) and `public/shaders/weather-post-compute.wgsl` (`extraBuffer` comment + `p_*` helpers).
4. Confirm both `WeatherPostProcessor` and `ComputeWeatherPostProcessor` still satisfy the exported `WeatherPostProcessorLike` interface (`src/renderer/weatherPostProcessorTypes.ts`).
5. Update WebGL GLSL `uWeather[...]` reads and any TS index access in `WebGLFallbackRenderer.ts`.
6. Update the hard-assert name→index table in `src/renderer/weatherUniformLayout.test.ts` and packing fixtures in `packWeatherParams.test.ts`.
7. Run `CI=true npm test -- --watchAll=false` (these suites do not require a real GPU).
