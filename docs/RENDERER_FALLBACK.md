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

1. Keep parameter indices aligned with the 40-float weather layout in `WebGPUCanvas.tsx`, `WeatherPostProcessor.ts`, `weather-post.wgsl`, and `WebGLFallbackRenderer.ts`.
2. Add the WebGL branch as a readable approximation first, then port the exact math to WGSL after the control behavior is verified.
3. Preserve effect isolation where possible. If WGSL support is added, route it through the same `RendererDebugOptions` contract rather than adding backend-specific URL flags.
4. Treat WebGL screenshots as reference/debug evidence, not proof of HDR parity.
