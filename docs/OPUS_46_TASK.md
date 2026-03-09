# Opus 4.6 Task: Advanced Graphics Polish & Integration

## Mission

Take the webgpu_streetview project from "functional" to "visually stunning" with advanced graphics programming.

## Current State

- 4 vehicle variants with basic materials
- Standard Three.js lighting
- Functional but not visually impressive
- Mixed material quality across components

## Your Challenge

### 1. PBR Material System (Advanced)

Create a complete physically-based rendering material system:

```typescript
// src/materials/PBRMaterials.ts
export class VehiclePBRMaterials {
  // Leather seats with roughness maps
  // Brushed metal dashboard with anisotropy
  // Glass with realistic transmission and IOR
  // Carbon fiber with normal maps
  // Velvet for limo interior with sheen
}
```

Requirements:
- Load and apply PBR texture sets (albedo, normal, roughness, metallic, AO)
- Generate procedural textures for materials without image assets
- Implement clear coat for car paint
- Add subtle imperfections (fingerprints on glossy surfaces, dust)

### 2. Custom Shader Effects (Expert)

Create post-processing and material shaders:

```glsl
// src/shaders/windowRain.frag
// Realistic rain streaks on windows with distortion
// Droplets that accumulate and flow down
// Wipers clear paths through rain

// src/shaders/dashboardGlow.frag  
// Volumetric glow from instrument panels
// Subsurface scattering for plastic materials
// Chromatic aberration on glass edges

// src/shaders/starfield.frag
// For limo ceiling - procedural twinkling stars
// Parallax effect based on head movement
```

### 3. Advanced Lighting

Implement studio-quality lighting:

- **HDRI Environment Mapping**: Generate procedural HDR skyboxes matching Street View time of day
- **Volumetric Fog**: Subtle light shafts through windows (dust particles in sunbeams)
- **Area Lights**: Convert point lights to realistic area lights for soft shadows
- **Screen Space Reflections (SSR)**: Real-time reflections on glossy surfaces
- **Contact Shadows**: High-quality close-proximity shadows

### 4. Animation Polish

Physics-based animations:

```typescript
// src/animation/PhysicsAnimations.ts
export class VehiclePhysicsAnimations {
  // Suspension bounce based on "road quality"
  // Steering wheel return-to-center with spring physics
  // Gear shift lever with realistic resistance
  // Pedals with hydraulic feel (slow return)
}
```

### 5. Visual Effects Suite

- **Lens Effects**: Subtle chromatic aberration, vignette, barrel distortion at edges
- **Depth of Field**: Bokeh effect when looking at close objects (dashboard)
- **Motion Blur**: Velocity-based blur for fast head movements
- **Film Grain**: Subtle noise for cinematic feel (optional toggle)
- **Bloom**: HDR glow from bright dashboard elements

### 6. UI Glass Morphism

Modern glass-morphism design:

```css
/* Glass panels for all UI overlays */
.glass-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

With:
- Dynamic blur intensity based on what's behind the UI
- Subtle refraction effects
- Smooth spring animations for panel openings

### 7. Procedural Environment Enhancement

Enhance the Street View skybox:

- **Dynamic Clouds**: Procedural cloud layers that drift slowly
- **Time of Day Lighting**: Adjust sun position/color based on SV capture time
- **Atmospheric Perspective**: Fade distant scenery with correct aerial perspective
- **Weather Integration**: Match visual mood to weather at SV location (overcast = flat lighting)

## Deliverables

1. **Material Library** (`src/materials/`) - Complete PBR system
2. **Shader Collection** (`src/shaders/`) - GLSL shaders for effects
3. **Post-Processing Pipeline** (`src/effects/PostProcessing.ts`) - Compositor setup
4. **Animation System** (`src/animation/PhysicsAnimations.ts`) - Physics-based motion
5. **Visual Presets** (`src/config/visualPresets.ts`) - Quality levels (low/medium/high/ultra)
6. **Documentation** (`src/docs/GRAPHICS.md`) - How the rendering pipeline works

## Success Criteria

- [ ] Build passes with zero TypeScript errors
- [ ] Runs at 60fps on GTX 1060 with "high" preset
- [ ] Visually stunning screenshots that look like real car photography
- [ ] All effects toggleable for accessibility/performance
- [ ] Memory usage stays under 2GB

## Stretch Goals

If time permits:
- Ray-marched volumetric clouds visible through sunroof
- Dynamic GI (global illumination) using light probes
- Cloth simulation for seat materials
- Fluid simulation for the champagne in limo mini bar

---

Push your changes to a new branch: `graphics-polish-opus46`

Report back with before/after screenshots and performance metrics.