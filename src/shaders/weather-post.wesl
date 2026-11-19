import package::weather::atmosphere::{applyDustParticles, applyFog, applyHeatShimmer, applyHumidityHaze, applyVolumetricLightShafts, fogAmountAt};
import package::weather::bindings::{linearSampler, lut3d, p, sceneTex};
import package::weather::grade::{aces_tonemap, applyContrast, applyExposure, applyLut, applySaturation, applyTemperatureTint, applyVibrance};
import package::weather::lens::{applyCameraFX, applyChromaticAberration, applyLensDroplets, applyLensFlare, applyVignette};
import package::weather::night::{applyNight, applySunrise, directionalMoonlight, domeLightCabinGlow, headlightBeams, headlightCone, headlightInteriorBounce, sunsetHorizonGlow};
import package::weather::precip::{rain, snow};
import package::weather::semantic::{semanticFog, semanticRain, semanticRelight, semanticSnowCover, semanticWetRoad};
import package::weather::sky::semanticSky;

@if(dual_source) enable dual_source_blending;

// Weather Post-Process Shader — fragment pass (the default).
// Dual-pass HDR weather effects: rain streaks + snow flakes + nighttime + headlights
// 100% procedural, no textures, runs in rgba16float HDR
// Atmospheric effects - fog, light shafts, heat shimmer, lens effects, dust, humidity
//
// WESL source, linked by scripts/gen-shaders.mjs into public/shaders/
// weather-post*.wgsl (the files the renderer fetches). The helpers live once in
// weather/*.wesl and lib/*.wesl and are shared with weather-post-compute.wesl;
// this file holds only the fragment pass's entry points. Variants (conditions):
//   dual_source — precipitation out through @blend_src(1) when the device
//                 enabled `dual-source-blending` (DUAL_SOURCE_PRECIP_BLEND);
//   hdr_grade   — the output-referred ACES (weather/grade.wesl), `?hdr`.

// Vertex shader - full screen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

// What one weather pixel shades to: the composited colour, and the
// precipitation that the dual-source variant also blends out separately.
struct WeatherShade {
    color: vec4<f32>,
    precip: vec3<f32>,
}

// ============================================================================
fn shadeWeather(fragCoord: vec4<f32>) -> WeatherShade {
    let texSize = vec2<f32>(textureDimensions(sceneTex));
    let uv = fragCoord.xy / texSize;
    
    // === SHADER BYPASS MODE ===
    // When shaderEffectsEnabled is 0, render raw Street View without effects
    if (p.shaderEffectsEnabled < 0.5) {
        return WeatherShade(vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0), vec3<f32>(0.0));
    }
    
    let t = p.time * p.speed;
    
    // Calculate camera pan offset for world-space weather effects
    // Convert normalized camera heading/pitch to -0.5 to 0.5 range for UV offset
    let panX = p.cameraHeading - 0.5;
    let panY = p.cameraPitch - 0.5;
    
    // === CHROMATIC ABERRATION ===
    var col = applyChromaticAberration(uv, p.chromaticAberration);

    // === CINEMATIC CAMERA FX (DOF + speed blur; no-op unless gated on) ===
    col = applyCameraFX(col, uv, p.dofStrength, p.motionBlurStrength);

    // === HEAT SHIMMER ===
    col = applyHeatShimmer(col, uv, p.heatShimmerIntensity, t);
    
    // === COLOR GRADING ===
    // Named looks bind a 3D LUT (texture, not a uniform). Identity / 1³ dummy
    // keeps the 6-knob chain so default ACES pixels do not change.
    if (textureDimensions(lut3d).x > 1u) {
        col = applyLut(col);
    } else {
        col = applyVibrance(col, p.vibrance);
        col = applySaturation(col, p.saturation);
        col = applyContrast(col, p.contrast);
        col = applyTemperatureTint(col, p.temperature, p.tint);
        col = applyExposure(col, p.exposure);
    }

    // === NIGHTTIME MODE ===
    // `graded` is the pre-night colour the semantic relight lights windows from.
    let graded = col;
    col = applyNight(col, p.nightIntensity, uv, t);
    col = semanticRelight(col, graded, uv, p.nightIntensity, t);

    // === HEADLIGHTS ===
    // Boosted contribution so night + headlights keeps the road readable (#171).
    if (p.headlightsOn > 0.5) {
        let hlCone = headlightCone(uv, p.headlightHeading, p.headlightPitch, p.highBeam);
        let nightMul = mix(0.55, 1.15, p.nightIntensity);
        col = col + hlCone * nightMul * 0.85;
        col = col * (1.0 + hlCone * nightMul * 0.4);

        let beams = headlightBeams(uv, p.headlightHeading, p.headlightPitch, p.highBeam, t);
        col = col + vec3<f32>(1.0, 0.95, 0.82) * beams * nightMul * 1.25;

        var fdx = uv.x - p.headlightHeading;
        if (fdx > 0.5) { fdx = fdx - 1.0; }
        if (fdx < -0.5) { fdx = fdx + 1.0; }
        let fdy = uv.y - p.headlightPitch;
        let flareDist = length(vec2<f32>(fdx, fdy));
        let flare = exp(-flareDist * flareDist * 120.0) * 0.2 * nightMul;
        col = col + vec3<f32>(1.0, 0.97, 0.88) * flare;
    }

    // === INTERIOR CABIN LIGHTING ===
    col = col + headlightInteriorBounce(uv, p.headlightsOn, p.nightIntensity) * 1.4;
    col = col + domeLightCabinGlow(uv, p.domeLightOn, p.domeLightIntensity) * 1.35;

    // === ASTRONOMICAL LIGHTING ===
    col = col + sunsetHorizonGlow(uv, p.sunAzimuth, p.sunAltitude, p.nightIntensity);
    col = applySunrise(col, uv, p.sunrise);
    col = directionalMoonlight(col, uv, p.moonAzimuth, p.moonAltitude, p.nightIntensity);

    // === SKY REPLACEMENT (#352; no-op without the semantic map) ===
    col = semanticSky(col, uv, texSize.x / texSize.y, t, p.cameraHeading, p.cameraPitch,
        p.sunAzimuth, p.sunAltitude, p.moonAzimuth, p.moonAltitude,
        p.nightIntensity, p.sunrise, p.rainIntensity, p.snowIntensity, p.fogIntensity);

    // === ATMOSPHERIC EFFECTS ===
    // Fog coverage is computed once and reused: it tints the scene *and*
    // attenuates everything suspended in it (dust, rain, snow).
    let fogMask = semanticFog(fogAmountAt(uv, p.fogIntensity, p.fogDensity, p.fogHeight, t), uv);
    col = applyFog(col, fogMask, p.fogColorIndex, p.nightIntensity);
    col = applyVolumetricLightShafts(col, uv, p.lightShaftsIntensity, t);
    col = applyHumidityHaze(col, uv, p.humidityHaze, t);
    col = applyDustParticles(col, uv, p.dustIntensity * (1.0 - fogMask * 0.8), t);
    col = applyLensFlare(col, uv, p.lensFlareIntensity);
    col = applyVignette(col, uv);

    // === WEATHER EFFECTS (RAIN/SNOW with world-space camera offset) ===
    // Precipitation sits in the same volume as the fog, so it fades into it
    // rather than punching through, and its scene darkening eases off at night
    // to keep the readable-night floor from #171 intact.
    let precipVisibility = 1.0 - fogMask * 0.75;
    var precipAdd = vec3<f32>(0.0);
    if (p.rainIntensity > 0.001) {
        let r = semanticRain(rain(uv, t, panX, panY), uv) * p.rainIntensity * precipVisibility;
        let rainTint = mix(vec3<f32>(0.78, 0.88, 1.15), vec3<f32>(0.60, 0.70, 1.02), p.nightIntensity);
        precipAdd = precipAdd + r * rainTint * (1.0 + p.headlightsOn * p.nightIntensity * 0.5);
        col = col * (1.0 - p.rainIntensity * mix(0.22, 0.10, p.nightIntensity));
        col = semanticWetRoad(col, uv, p.rainIntensity, p.nightIntensity, t);
    }

    if (p.snowIntensity > 0.001) {
        let s = snow(uv, t, panX, panY) * p.snowIntensity * precipVisibility;
        let snowLit = 1.0 + p.headlightsOn * p.nightIntensity * 0.35;
        precipAdd = precipAdd + s * vec3<f32>(1.15, 1.18, 1.22) * snowLit;
        col = semanticSnowCover(col, uv, p.snowIntensity, p.nightIntensity);
    }
    col = col + precipAdd;

    // === REFRACTIVE LENS DROPLETS ===
    // Applied after rain streaks so droplets sit "on top" of streaks on the lens
    if (p.rainIntensity > 0.05) {
        col = applyLensDroplets(col, uv, t, clamp(p.rainIntensity * 0.8, 0.0, 1.0));
    }

    // === HDR TONEMAPPING ===
    // Apply ACES filmic curve to smoothly compress bright highlights
    // This prevents harsh clipping when sun flare overlaps with headlights, etc.
    col = aces_tonemap(col);

    // Final cheap dither to prevent banding
    let noise = fract(sin(dot(fragCoord.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    col = col + (noise - 0.5) * 0.0025;

    return WeatherShade(vec4<f32>(col, 1.0), precipAdd);
}

// Dual-source precipitation: same colour, and the precipitation in
// @blend_src(1). DUAL_SOURCE_PRECIP_BLEND (one, src1) over the cleared target is
// `color + 0 * precip`, i.e. the in-shader composite.
@if(dual_source)
struct DualFragOut {
    @location(0) @blend_src(0) color: vec4<f32>,
    @location(0) @blend_src(1) precip: vec4<f32>,
}

@if(dual_source)
@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> DualFragOut {
    let s = shadeWeather(fragCoord);
    return DualFragOut(s.color, vec4<f32>(s.precip, 0.0));
}
@else
@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    return shadeWeather(fragCoord).color;
}
