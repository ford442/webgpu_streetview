// Bind groups 0 and 1 of the weather post-process, for both of its paths, and
// the accessors every shared weather helper reads them through.
//
// The fragment pass (`weather-post.wesl`, the default) binds the 44-float
// block as a `WeatherParams` uniform; the compute pass
// (`weather-post-compute.wesl`, `?weather=compute` / High / Ultra) binds the
// same floats as `extraBuffer`, a storage array in the image_video_effects
// header layout. Shared helpers never touch either directly: they call
// `p_<field>()`, `sampleScene()` and `wasmNoiseAt()`, which the `compute`
// condition resolves to one binding or the other at link time
// (scripts/gen-shaders.mjs). The field order is `WeatherParamIndex` in
// src/renderer/weatherUniformLayout.ts.
//
// Each accessor returns its binding verbatim, so a helper written against them
// is bit-exact with the one it replaced on either path. `p_speed()` exists on
// the compute path only (clamped — the fragment entry reads `p.speed` itself).
// The GPU precipitation pass links this module too (`compute` and
// `weather_particles`), so the weather block has one reader in WGSL.


// --- fragment path (group 0) ---

@if(!compute)
struct WeatherParams {
    // 0-5: color grading params
    vibrance     : f32,
    saturation   : f32,
    contrast     : f32,
    exposure     : f32,
    temperature  : f32,
    tint         : f32,
    // 6-10: weather params
    time         : f32,
    rainIntensity: f32,   // 0–2
    snowIntensity: f32,   // 0–2
    wind         : f32,   // -1.0 left → +1.0 right
    speed        : f32,   // 0.5–2.0 (global animation speed)
    // 11-15: nighttime + headlights
    nightIntensity   : f32,   // 0.0 = day, 1.0 = full night
    headlightsOn     : f32,   // 0.0 = off, 1.0 = on
    highBeam         : f32,   // 0.0 = low beam, 1.0 = high beam
    headlightHeading : f32,   // normalized heading (0–1, same as panX)
    headlightPitch   : f32,   // normalized pitch (0–1, same as panY)
    // 16-17: dome light
    domeLightOn       : f32,  // 0.0 = off, 1.0 = on
    domeLightIntensity: f32,  // 0.0–1.0 smoothed brightness
    // 18-21: astronomical sun/moon positions (SunCalc radians: 0=S, π/2=W, π=N, -π/2=E)
    sunAzimuth        : f32,  // sun azimuth (radians)
    sunAltitude       : f32,  // sun altitude above horizon (radians, negative = below)
    moonAzimuth       : f32,  // moon azimuth (radians)
    moonAltitude      : f32,  // moon altitude above horizon (radians)
    // 22-31: atmospheric effects params
    fogIntensity      : f32,  // 0.0-1.0 overall fog strength
    fogDensity        : f32,  // 0.0-2.0 fog thickness
    fogHeight         : f32,  // 0.0-1.0 height factor (0=ground level, 1=high altitude)
    fogColorIndex     : f32,  // 0=gray, 1=blue, 2=brown, 3=green
    lightShaftsIntensity : f32, // 0.0-1.0 volumetric light shafts
    heatShimmerIntensity : f32, // 0.0-1.0 heat distortion
    lensFlareIntensity   : f32, // 0.0-1.0 lens flare when looking at sun
    chromaticAberration  : f32, // 0.0-1.0 RGB split at edges
    dustIntensity     : f32,  // 0.0-1.0 floating particles
    humidityHaze      : f32,  // 0.0-1.0 distance softening
    // 32: Shader toggle
    shaderEffectsEnabled : f32, // 1.0 = effects on, 0.0 = raw Street View
    // 33-35: Camera view parameters (NEW - for world-space effects)
    cameraHeading     : f32,  // normalized camera heading (0-1, same as panX)
    cameraPitch       : f32,  // normalized camera pitch (0-1, same as panY)
    wasmNoiseEnabled  : f32,  // 1.0 = sample the WASM-computed noise tile (dust turbulence), 0.0 = off
    // 36: sunrise
    sunrise           : f32,  // 0.0 = no sunrise, 1.0 = full sunrise
    // 37: anamorphic lens flare streak width (0 = off, 0.5 = moderate)
    anamorphicStreak  : f32,
    // 38-39: cinematic camera FX — gated on CPU by quality >= high and
    // prefers-reduced-motion (src/renderer/cinematicCameraFx.ts). 0 = off.
    dofStrength        : f32,  // 0.0-1.0 far-field lens defocus
    motionBlurStrength : f32,  // 0.0-1.0 radial speed blur (car/cruise coupled)
    // 40-43: image-derived horizon (src/renderer/gpuChores/horizonEstimate.ts)
    horizonEstimateY   : f32,  // screen-space horizon estimate (top-origin)
    horizonBlend       : f32,  // 0.0 = pitch-only horizon, 1.0 = estimate
    horizonPad0        : f32,  // pads the block to 44 floats / 176 bytes
    horizonPad1        : f32,
}

@if(!compute) @group(0) @binding(0) var<uniform> p: WeatherParams;
@if(!compute) @group(0) @binding(1) var sceneTex: texture_2d<f32>;
@if(!compute) @group(0) @binding(2) var linearSampler: sampler;
// CPU-computed Perlin noise tile (src/wasm/wasmNoiseFeeder.ts), refreshed
// every ~30 frames via device.queue.writeBuffer — a coarser, more organic
// alternative to the per-pixel GPU hash noise used elsewhere.
@if(!compute) @group(0) @binding(3) var<storage, read> wasmNoiseTile: array<f32, 4096>;

// --- compute path (group 0): the standard image_video_effects header ---
// Bindings 0 and 1 are that header's `u_sampler` / `readTexture`, named for
// what they hold so the shared helpers read the same identifiers on both paths.
//
// STORAGE SURFACES IN USE (formerly 1x1 dummies):
//  - binding 4 readDepthTexture : previous frame view-depth (ping-pong read).
//  - binding 6 writeDepthTexture: current frame view-depth (ping-pong write).
//  - binding 7 dataTextureA : half-res particle *density* splat (rgba32float,
//    readable). 1x1 dummy when GPU particles are off.
//  - binding 8 dataTextureB : compact particle *state* write target (rgba32float
//    storage). Paired with an internal ping-pong read that lives outside this
//    header; 1x1 dummy when GPU particles are off.
//  - binding 12 plasmaBuffer : the real 64x64 WASM Perlin tile (#128/#189),
//    packed as 1024 vec4s, driving dust turbulence exactly like the fragment
//    path's `wasmNoiseTile`.
// Still dummy: dataTextureC (9).
@if(compute) @group(0) @binding(0) var linearSampler: sampler;
@if(compute) @group(0) @binding(1) var sceneTex: texture_2d<f32>;
// rgba16float: COMPUTE_WEATHER_OUTPUT_FORMAT in src/renderer/computeWeather/constants.ts.
@if(compute) @group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@if(compute) @group(0) @binding(3) var<uniform> u: Uniforms;
@if(compute) @group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@if(compute) @group(0) @binding(5) var non_filtering_sampler: sampler;
@if(compute) @group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;
@if(compute) @group(0) @binding(7) var dataTextureA: texture_2d<f32>;
@if(compute) @group(0) @binding(8) var dataTextureB: texture_storage_2d<rgba32float, write>;
@if(compute) @group(0) @binding(9) var dataTextureC: texture_2d<f32>;
@if(compute && !weather_particles) @group(0) @binding(10) var<storage, read_write> extraBuffer: array<f32>;
// The GPU precipitation pass (weather-particles.wesl) binds the same buffer at
// binding 2, read-only, and reads it through the same accessors.
@if(weather_particles) @group(0) @binding(2) var<storage, read> extraBuffer: array<f32>;
@if(compute) @group(0) @binding(11) var comparison_sampler: sampler_comparison;
@if(compute) @group(0) @binding(12) var<storage, read> plasmaBuffer: array<vec4<f32>>;

@if(compute)
struct Uniforms {
  config: vec4<f32>,       // x=Time, y=Generic1, z=ResX, w=ResY
  zoom_config: vec4<f32>,  // x=ZoomTime, y=MouseX, z=MouseY, w=Generic2
  zoom_params: vec4<f32>,  // x=Param1, y=Param2, z=Param3, w=Param4
  ripples: array<vec4<f32>, 50>,
};

// 3D film LUT (group 1, both paths). A 1×1×1 dummy means identity — skip
// sampling so default ACES pixels stay bit-identical to the pre-LUT path.
@group(1) @binding(0) var lut3d: texture_3d<f32>;
@group(1) @binding(1) var lutSampler: sampler;

// --- accessors ---
@if(compute) fn ep(i: i32) -> f32 { return extraBuffer[i]; }
@if(compute) fn p_speed() -> f32 { return max(ep(10), 0.001); }

@if(compute) fn p_vibrance() -> f32 { return ep(0); }
@else fn p_vibrance() -> f32 { return p.vibrance; }
@if(compute) fn p_saturation() -> f32 { return ep(1); }
@else fn p_saturation() -> f32 { return p.saturation; }
@if(compute) fn p_contrast() -> f32 { return ep(2); }
@else fn p_contrast() -> f32 { return p.contrast; }
@if(compute) fn p_exposure() -> f32 { return ep(3); }
@else fn p_exposure() -> f32 { return p.exposure; }
@if(compute) fn p_temperature() -> f32 { return ep(4); }
@else fn p_temperature() -> f32 { return p.temperature; }
@if(compute) fn p_tint() -> f32 { return ep(5); }
@else fn p_tint() -> f32 { return p.tint; }
@if(compute) fn p_time() -> f32 { return ep(6); }
@else fn p_time() -> f32 { return p.time; }
@if(compute) fn p_rainIntensity() -> f32 { return ep(7); }
@else fn p_rainIntensity() -> f32 { return p.rainIntensity; }
@if(compute) fn p_snowIntensity() -> f32 { return ep(8); }
@else fn p_snowIntensity() -> f32 { return p.snowIntensity; }
@if(compute) fn p_wind() -> f32 { return ep(9); }
@else fn p_wind() -> f32 { return p.wind; }
@if(compute) fn p_nightIntensity() -> f32 { return ep(11); }
@else fn p_nightIntensity() -> f32 { return p.nightIntensity; }
@if(compute) fn p_headlightsOn() -> f32 { return ep(12); }
@else fn p_headlightsOn() -> f32 { return p.headlightsOn; }
@if(compute) fn p_highBeam() -> f32 { return ep(13); }
@else fn p_highBeam() -> f32 { return p.highBeam; }
@if(compute) fn p_headlightHeading() -> f32 { return ep(14); }
@else fn p_headlightHeading() -> f32 { return p.headlightHeading; }
@if(compute) fn p_headlightPitch() -> f32 { return ep(15); }
@else fn p_headlightPitch() -> f32 { return p.headlightPitch; }
@if(compute) fn p_domeLightOn() -> f32 { return ep(16); }
@else fn p_domeLightOn() -> f32 { return p.domeLightOn; }
@if(compute) fn p_domeLightIntensity() -> f32 { return ep(17); }
@else fn p_domeLightIntensity() -> f32 { return p.domeLightIntensity; }
@if(compute) fn p_sunAzimuth() -> f32 { return ep(18); }
@else fn p_sunAzimuth() -> f32 { return p.sunAzimuth; }
@if(compute) fn p_sunAltitude() -> f32 { return ep(19); }
@else fn p_sunAltitude() -> f32 { return p.sunAltitude; }
@if(compute) fn p_moonAzimuth() -> f32 { return ep(20); }
@else fn p_moonAzimuth() -> f32 { return p.moonAzimuth; }
@if(compute) fn p_moonAltitude() -> f32 { return ep(21); }
@else fn p_moonAltitude() -> f32 { return p.moonAltitude; }
@if(compute) fn p_fogIntensity() -> f32 { return ep(22); }
@else fn p_fogIntensity() -> f32 { return p.fogIntensity; }
@if(compute) fn p_fogDensity() -> f32 { return ep(23); }
@else fn p_fogDensity() -> f32 { return p.fogDensity; }
@if(compute) fn p_fogHeight() -> f32 { return ep(24); }
@else fn p_fogHeight() -> f32 { return p.fogHeight; }
@if(compute) fn p_fogColorIndex() -> f32 { return ep(25); }
@else fn p_fogColorIndex() -> f32 { return p.fogColorIndex; }
@if(compute) fn p_lightShaftsIntensity() -> f32 { return ep(26); }
@else fn p_lightShaftsIntensity() -> f32 { return p.lightShaftsIntensity; }
@if(compute) fn p_heatShimmerIntensity() -> f32 { return ep(27); }
@else fn p_heatShimmerIntensity() -> f32 { return p.heatShimmerIntensity; }
@if(compute) fn p_lensFlareIntensity() -> f32 { return ep(28); }
@else fn p_lensFlareIntensity() -> f32 { return p.lensFlareIntensity; }
@if(compute) fn p_chromaticAberration() -> f32 { return ep(29); }
@else fn p_chromaticAberration() -> f32 { return p.chromaticAberration; }
@if(compute) fn p_dustIntensity() -> f32 { return ep(30); }
@else fn p_dustIntensity() -> f32 { return p.dustIntensity; }
@if(compute) fn p_humidityHaze() -> f32 { return ep(31); }
@else fn p_humidityHaze() -> f32 { return p.humidityHaze; }
@if(compute) fn p_shaderEffectsEnabled() -> f32 { return ep(32); }
@else fn p_shaderEffectsEnabled() -> f32 { return p.shaderEffectsEnabled; }
@if(compute) fn p_cameraHeading() -> f32 { return ep(33); }
@else fn p_cameraHeading() -> f32 { return p.cameraHeading; }
@if(compute) fn p_cameraPitch() -> f32 { return ep(34); }
@else fn p_cameraPitch() -> f32 { return p.cameraPitch; }
@if(compute) fn p_wasmNoiseEnabled() -> f32 { return ep(35); }
@else fn p_wasmNoiseEnabled() -> f32 { return p.wasmNoiseEnabled; }
@if(compute) fn p_sunrise() -> f32 { return ep(36); }
@else fn p_sunrise() -> f32 { return p.sunrise; }
@if(compute) fn p_anamorphicStreak() -> f32 { return ep(37); }
@else fn p_anamorphicStreak() -> f32 { return p.anamorphicStreak; }
@if(compute) fn p_dofStrength() -> f32 { return ep(38); }
@else fn p_dofStrength() -> f32 { return p.dofStrength; }
@if(compute) fn p_motionBlurStrength() -> f32 { return ep(39); }
@else fn p_motionBlurStrength() -> f32 { return p.motionBlurStrength; }
@if(compute) fn p_horizonEstimateY() -> f32 { return ep(40); }
@else fn p_horizonEstimateY() -> f32 { return p.horizonEstimateY; }
@if(compute) fn p_horizonBlend() -> f32 { return ep(41); }
@else fn p_horizonBlend() -> f32 { return p.horizonBlend; }

// The scene colour at a UV: implicit-derivative `textureSample` in the
// fragment pass, level 0 in compute (no derivatives there). Exactly what each
// path called before the helpers were shared.
@if(compute)
fn sampleScene(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(sceneTex, linearSampler, uv, 0.0);
}
@else
fn sampleScene(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(sceneTex, linearSampler, uv);
}

// One texel of the 64x64 WASM noise tile (row-major index).
@if(compute)
fn wasmNoiseAt(index: i32) -> f32 {
    // 1024 vec4s; clamped because the storage array is runtime-sized.
    let i = clamp(index, 0, 4095);
    let packed = plasmaBuffer[i / 4];
    return packed[u32(i % 4)];
}
@else
fn wasmNoiseAt(index: i32) -> f32 {
    return wasmNoiseTile[index];
}
