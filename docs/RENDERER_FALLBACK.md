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

## WebGPU Init Contract

`Renderer.ts` now uses an explicit adapter/configuration policy before creating pipelines:

- **Adapter request policy**:
  - `?gpu=low` / `?gpu=low-power` => `requestAdapter({ powerPreference: 'low-power' })`
  - `?gpu=high` / `?gpu=high-performance` => `requestAdapter({ powerPreference: 'high-performance' })`
  - Otherwise, battery heuristic (`navigator.getBattery`) prefers low-power when unplugged and <=20%; default is high-performance.
- **Limit probing**: renderer checks required adapter limits (always `maxTextureDimension2D >= 4096`; compute weather additionally requires storage-buffer minima) and fails soft to fallback with a descriptive reason.
- **Canvas configure** is explicit:
  - `alphaMode: 'opaque'`
  - `colorSpace: 'srgb'`
  - `usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC`
- **Device loss path**: on `device.lost`, renderer stops rendering, tears down GPU resources, calls `context.unconfigure()`, and relies on `WebGPUCanvas.tsx` reinit (`reinitCounter`) to construct a fresh renderer instance.
- **Adapter probe surface**: a summarized adapter record is logged once and exposed at `window.rendererAdapterInfo` for diagnostics.

## In-App Control

All of the above is also reachable without DevTools: a small `WebGPU` / `WebGL2 (fallback)` / `Raw fallback` chip is pinned to the bottom-left corner of the app whenever a renderer is active, in both FreeLook and Car Mode (it sits above the Three.js car overlay, so it stays clickable while driving). Clicking it expands a panel with WebGPU/WebGL2 buttons — these just call `window.streetViewRendererDebug.setBackend(...)` under the hood, so switching backends still persists the choice to `localStorage` and reloads the page, same as the DevTools API. When the active backend is WebGL2, the panel also exposes the effect-isolation dropdown and a wireframe checkbox described below; both apply live, with no reload, visible immediately through the car windows if you're in Car Mode. The chip is a thin UI wrapper, not a second source of truth — `window.streetViewRendererDebug` remains fully supported for scripting and automation.

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

## Weather Post-Process: Fragment vs Compute

The WebGPU backend's second pass (weather rain/snow/fog/color grading) has two implementations that render the same effects from the same 40-float parameter layout:

- **Fragment** (default): `src/renderer/WeatherPostProcessor.ts` + `public/shaders/weather-post.wgsl`. A single fullscreen-triangle render pass sampling the HDR intermediate texture.
- **Compute**: `src/renderer/ComputeWeatherPostProcessor.ts` + `public/shaders/weather-post-compute.wgsl`. A compute pass (`@workgroup_size(16, 16, 1)`) writes into an `rgba32float` storage texture, followed by a cheap `textureLoad` blit render pass to the canvas. It exposes `image_video_effects`-compatible bindings for depth textures, data textures, and a `plasmaBuffer` storage array — currently bound to 1x1 dummy resources, reserved for future WASM-fed noise tiles (#128), volumetric fog, and GPU particles that want storage-buffer access a fragment pass can't offer efficiently.

Both read the same `40-float` weather parameter layout, defined once in `src/renderer/weatherUniformLayout.ts` (`WeatherParamIndex`) and mirrored in both WGSL files' comments — see "Shader Uniform Layouts" in `AGENTS.md`.

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

Known gap: the compute path does not yet sample the WASM-computed 64x64 noise tile (`wasmNoiseTile` in `weather-post.wgsl`) that the fragment path uses for dust-cloud turbulence — `wasmNoiseEnabled` is read but has no visual effect in the compute shader yet. Rain, snow, fog, color grading, night/headlight lighting, and astronomical effects are otherwise at parity between the two paths.

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
