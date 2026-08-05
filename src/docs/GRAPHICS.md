# Graphics & Rendering Pipeline

> **Weather & atmosphere look targets live in [`docs/GRAPHICS.md`](../../docs/GRAPHICS.md)** —
> preset intent, the CPU cohesion model, the view-depth proxy, before/after
> tuning notes, and the cinematic camera FX gate. This file covers the broader
> pipeline and material system.

## Architecture Overview

The WebGPU StreetView application uses a **dual-renderer architecture**:

1. **WebGPU Renderer** — Handles the Street View panorama capture, transformation, and display. The `Renderer` class (`src/renderer/Renderer.ts`) orchestrates GPU device initialization, texture management, pipeline creation, and per-frame uploads from the hidden Google Maps canvas via `copyExternalImageToTexture`.

2. **Three.js WebGL Overlay** — Renders the 3D car interior model on top of the panorama using a transparent WebGL canvas. Three.js manages the car mesh, dashboard instruments, and interior lighting as a scene graph layered over the WebGPU output.

```
┌─────────────────────────────────────┐
│           Composite Output          │
├──────────────────┬──────────────────┤
│  Three.js WebGL  │  Post-Processing │
│  Car Interior    │  Effects Chain   │
├──────────────────┴──────────────────┤
│        WebGPU Panorama Layer        │
├─────────────────────────────────────┤
│   Hidden Google Maps Canvas (src)   │
└─────────────────────────────────────┘
```

---

## Material System

PBR (Physically Based Rendering) materials are defined in `src/materials/` and provide a consistent look across all rendered surfaces.

| Material          | File                        | Usage                        |
|-------------------|-----------------------------|------------------------------|
| Car Paint         | `src/materials/carPaint.ts` | Metallic vehicle body        |
| Dashboard Plastic | `src/materials/dashboard.ts`| Matte interior surfaces      |
| Glass             | `src/materials/glass.ts`    | Windows, mirrors             |
| Leather           | `src/materials/leather.ts`  | Seats, steering wheel        |
| Chrome            | `src/materials/chrome.ts`   | Trim, accents                |

### Quality Presets

Each material supports quality tiers configured in `src/config/qualityPresets.ts`:

- **Low** — Flat shading, no reflections, minimal texture resolution
- **Medium** — Standard PBR, environment map sampling, 1K textures
- **High** — Full PBR with subsurface scattering hints, 2K textures, real-time reflections
- **Ultra** — Ray-traced reflections (where supported), 4K textures, anisotropic filtering

---

## Shader Collection

### WGSL Shaders (`public/shaders/`)

Loaded at runtime via `fetch()` from `/shaders/*.wgsl`. Copied from `public/shaders/` to `build/shaders/` during the build.

| Shader              | File                        | Description                                                                 |
|---------------------|-----------------------------|-----------------------------------------------------------------------------|
| **streetview.wgsl** | `public/shaders/streetview.wgsl` | Main panoramic viewer. Vertex shader generates a fullscreen triangle strip; fragment shader samples the captured texture with zoom/pan uniforms `[time, zoom, panX, panY]`. UV wraps horizontally, clamps vertically. |
| **carview.wgsl**    | `public/shaders/carview.wgsl`    | Car-view post-processing. Applies vignette, color grading, and slight barrel distortion to simulate a windshield perspective. |
| **weather-post.wgsl** | `public/shaders/weather-post.wgsl` | Weather overlay effects — fog density, rain distortion, snow accumulation composited onto the panorama. |
| **texture.wgsl**    | `public/shaders/texture.wgsl`    | Simple passthrough texture sampler available for utility/debug use.          |

### GLSL Shaders (`src/shaders/`)

Used by the Three.js overlay layer for interior-specific effects.

| Shader            | File                              | Description                                                              |
|-------------------|-----------------------------------|--------------------------------------------------------------------------|
| **windowRain**    | `src/shaders/windowRain.glsl`     | Simulates rain droplets and streaks on glass surfaces. Uses animated noise to spawn, merge, and trail drops down the window with refraction distortion. |
| **dashboardGlow** | `src/shaders/dashboardGlow.glsl`  | Emissive glow on instrument cluster and controls. Driven by vehicle speed and audio reactivity uniforms. |
| **starfield**     | `src/shaders/starfield.glsl`      | Procedural star field for limo ceiling. Generates twinkling points with parallax based on camera orientation. |

---

## Post-Processing Pipeline

Effects are chained in `src/effects/` and execute in order after the base panorama render:

```
Panorama Texture
  │
  ├─► [1] Weather Post-Processing  (weather-post.wgsl)
  │       Fog, rain distortion, snow overlay
  │
  ├─► [2] Car View Post-Processing (carview.wgsl)
  │       Vignette, barrel distortion, color grading
  │
  ├─► [3] Bloom Pass              (src/effects/bloom.ts)
  │       Extracts bright pixels, blurs, composites
  │
  ├─► [4] Tone Mapping            (src/effects/tonemap.ts)
  │       ACES filmic tone mapping, gamma correction
  │
  └─► Final Composite → Screen
```

Each effect reads from the previous pass's output texture and writes to its own render target. The `EffectComposer` (`src/effects/EffectComposer.ts`) manages the chain, allowing effects to be enabled/disabled at runtime.

---

## Animation System

Physics-based animations live in `src/animation/` and drive smooth transitions across the UI and 3D scene.

| Module                  | Purpose                                                    |
|-------------------------|------------------------------------------------------------|
| `SpringAnimator.ts`     | Damped spring physics for panel open/close, camera sway    |
| `EasingFunctions.ts`    | Standard easing curves (ease-in-out, cubic-bezier, bounce) |
| `VehicleAnimator.ts`    | Suspension bounce, steering wheel rotation, speed wobble   |
| `TransitionManager.ts`  | Coordinates multi-property animations with stagger/delay   |

Animations are tick-driven via `requestAnimationFrame` and expose an `update(dt)` interface consumed by the render loop.

---

## Visual Presets

Quality presets are defined in `src/config/qualityPresets.ts` and control every visual subsystem:

```typescript
interface QualityPreset {
  label: string;
  textureResolution: 512 | 1024 | 2048 | 4096;
  shadowMapSize: number;
  enableBloom: boolean;
  enableWeatherEffects: boolean;
  enableReflections: boolean;
  maxLights: number;
  antiAliasing: 'none' | 'fxaa' | 'msaa4x';
  targetFrameRate: 30 | 60;
}
```

Presets are selected automatically based on GPU tier detection or manually via the settings panel. The `QualityManager` (`src/config/QualityManager.ts`) monitors frame times and can auto-downgrade if performance drops below the target.

---

## Lighting System

The `LightingEffects` manager (`src/renderer/LightingEffects.ts`) controls scene illumination:

- **Ambient Light** — Base scene illumination derived from panorama average luminance
- **Dashboard Lights** — Point lights on instrument cluster, reactive to speed/audio
- **Street Lights** — Extracted from panorama bright spots, cast volumetric glow
- **Headlights** — Forward-facing spot lights with cone angle matching vehicle type
- **Time-of-Day** — Color temperature and intensity shift based on sun position metadata

The lighting state is updated each frame and passed as uniform data to both the WebGPU and Three.js renderers.

---

## Performance Considerations

### GPU Profiling

- Use `GPUCommandEncoder.writeTimestamp()` (when available) to measure pass durations.
- The `Renderer` exposes `getFrameStats()` returning last frame GPU time, texture upload time, and draw call count.
- Chrome DevTools → Performance → GPU track provides frame-level visibility.

### Level of Detail (LOD)

- Interior mesh LOD switches at distance thresholds (dashboard detail reduces when camera is far).
- Texture mip levels are pre-generated; the sampler selects based on screen-space coverage.
- Post-processing resolution scales with quality preset (half-res bloom on Low).

### Frame Rate Control

- `requestAnimationFrame` drives the loop; the `QualityManager` monitors `performance.now()` deltas.
- If average frame time exceeds target (16.6 ms for 60 fps), the manager reduces post-processing or texture resolution.
- Canvas texture recreation occurs only when source dimensions change, avoiding per-frame allocation.

### Memory Management

- Textures are pooled and reused across effect passes.
- GPU buffers are created once and updated via `writeBuffer()`.
- The `Renderer` calls `device.destroy()` on unmount to free GPU resources.

---

## How to Add New Effects

1. **Create the shader** — Add a `.wgsl` file in `public/shaders/` (for WebGPU passes) or a `.glsl` file in `src/shaders/` (for Three.js materials).

2. **Create the effect class** — Add a new file in `src/effects/`:
   ```typescript
   export class MyEffect {
     private pipeline: GPURenderPipeline;

     async init(device: GPUDevice): Promise<void> {
       const shader = await fetch('/shaders/my-effect.wgsl').then(r => r.text());
       // Create pipeline, bind groups, etc.
     }

     render(encoder: GPUCommandEncoder, input: GPUTexture, output: GPUTexture): void {
       // Dispatch render pass
     }
   }
   ```

3. **Register in the effect chain** — Add the effect to `EffectComposer.ts`:
   ```typescript
   this.effects.push(new MyEffect());
   ```

4. **Add quality gate** — In `qualityPresets.ts`, add a boolean flag so the effect can be toggled per quality tier.

5. **Test** — Verify the effect renders correctly at all quality presets and does not regress frame rate below the target threshold.
