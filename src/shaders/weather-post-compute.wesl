import package::lib::sceneDepth::sceneDepth;
import package::weather::atmosphere::{applyDustParticles, applyFog, applyHumidityHaze, applyVolumetricLightShafts, fogAmountAt, getHeatShimmerOffset};
import package::weather::bindings::{dataTextureA, dataTextureB, dataTextureC, linearSampler, lut3d, p_cameraHeading, p_cameraPitch, p_chromaticAberration, p_contrast, p_dofStrength, p_domeLightIntensity, p_domeLightOn, p_dustIntensity, p_exposure, p_fogColorIndex, p_fogDensity, p_fogHeight, p_fogIntensity, p_headlightHeading, p_headlightPitch, p_headlightsOn, p_heatShimmerIntensity, p_highBeam, p_humidityHaze, p_lensFlareIntensity, p_lightShaftsIntensity, p_moonAltitude, p_moonAzimuth, p_motionBlurStrength, p_nightIntensity, p_rainIntensity, p_saturation, p_shaderEffectsEnabled, p_snowIntensity, p_speed, p_sunAltitude, p_sunAzimuth, p_sunrise, p_temperature, p_time, p_tint, p_vibrance, readDepthTexture, sceneTex, u, writeDepthTexture, writeTexture};
import package::weather::grade::{aces_tonemap, applyContrast, applyExposure, applyLut, applySaturation, applyTemperatureTint, applyVibrance};
import package::weather::horizon::sceneHorizonY;
import package::weather::lens::{applyCameraFX, applyChromaticAberration, applyLensDroplets, applyLensFlare, applyVignette};
import package::weather::night::{applyNight, applySunrise, directionalMoonlight, domeLightCabinGlow, headlightBeams, headlightCone, headlightInteriorBounce, sunsetHorizonGlow};
import package::weather::precip::{rain, snow};
import package::weather::semantic::{semanticFog, semanticRain, semanticRainParticles, semanticRelight, semanticSnowCover, semanticWetRoad};
import package::weather::sky::semanticSky;

// Weather Post-Process Shader — compute pass (`?weather=compute`, High / Ultra).
// Compatible with the image_video_effects WGSL compute pipeline: the weather
// block rides in extraBuffer (weather/bindings.wesl, `compute` condition).
//
// WESL source, linked by scripts/gen-shaders.mjs into public/shaders/
// weather-post-compute*.wgsl. Every effect helper is shared with the fragment
// pass (weather/*.wesl, lib/*.wesl); this file holds what only the compute
// pass has — the clamped speed, the GPU particle layer, the colour history —
// and `main`. Variant (condition):
//   hdr_grade — the output-referred ACES (weather/grade.wesl), `?hdr`.

// GPU particle density (binding 7). Procedural rain()/snow() stay the base
// look, shared with the fragment pass; this layer is compute-only.
fn applyParticlePrecipitation(col: vec3<f32>, uv: vec2<f32>, viewDepth: f32) -> vec3<f32> {
    let dims = vec2<i32>(textureDimensions(dataTextureA));
    let stateDims = textureDimensions(dataTextureB);
    if (dims.x <= 1 || dims.y <= 1 || stateDims.x <= 1) {
        return col;
    }
    let rainI = p_rainIntensity();
    let snowI = p_snowIntensity();
    if (rainI + snowI < 0.001) {
        return col;
    }

    let size = vec2<f32>(f32(dims.x), f32(dims.y));
    let scaled = uv * size - vec2<f32>(0.5);
    let i0 = vec2<i32>(floor(scaled));
    let f = fract(scaled);
    let s00 = textureLoad(dataTextureA, clamp(i0, vec2<i32>(0), dims - 1), 0);
    let s10 = textureLoad(dataTextureA, clamp(i0 + vec2<i32>(1, 0), vec2<i32>(0), dims - 1), 0);
    let s01 = textureLoad(dataTextureA, clamp(i0 + vec2<i32>(0, 1), vec2<i32>(0), dims - 1), 0);
    let s11 = textureLoad(dataTextureA, clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0), dims - 1), 0);
    let splat = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);

    let alive = step(0.001, splat.a);
    // Particle alpha is a view-depth layer; hide flakes behind the proxy.
    let visible = step(splat.a, viewDepth + 0.08);
    let windshield = mix(0.32, 1.0, smoothstep(0.06, 0.78, uv.y));
    let hl = headlightCone(uv, p_headlightHeading(), p_headlightPitch(), p_highBeam());
    let hlBoost = 1.0 + length(hl) * p_headlightsOn() * p_nightIntensity() * 2.4;
    return col + splat.rgb * alive * visible * windshield * hlBoost;
}

fn applyTemporalHistory(col: vec3<f32>, coord: vec2<i32>, depth: f32) -> vec3<f32> {
    let histSize = textureDimensions(dataTextureC);
    if (histSize.x <= 1u) {
        return col;
    }
    let prev = textureLoad(dataTextureC, coord, 0).rgb;
    let prevDepth = textureLoad(readDepthTexture, coord, 0).r;
    if (abs(depth - prevDepth) > 0.08) {
        return col;
    }
    return mix(prev, col, 0.22);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
        return;
    }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let t = p_time() * p_speed();

    // Scene depth for this pixel (the proxy, blended with the depth map when
    // one is bound), published to the r32float storage texture at binding 6
    // and reused below for particle occlusion and temporal history.
    let horizonY = sceneHorizonY();
    let viewDepth = sceneDepth(uv, horizonY);
    textureStore(writeDepthTexture, vec2<i32>(global_id.xy), vec4<f32>(viewDepth, 0.0, 0.0, 1.0));

    // Bypass mode
    if (p_shaderEffectsEnabled() < 0.5) {
        let raw = textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb;
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(raw, 1.0));
        return;
    }

    let panX = p_cameraHeading() - 0.5;
    let panY = p_cameraPitch() - 0.5;

    // Chromatic aberration
    var col = applyChromaticAberration(uv, p_chromaticAberration());

    // Cinematic camera FX (DOF + speed blur; no-op unless gated on)
    col = applyCameraFX(col, uv, p_dofStrength(), p_motionBlurStrength());

    // Heat shimmer
    let heatOffset = getHeatShimmerOffset(uv, p_heatShimmerIntensity(), t);
    let heatUV = uv + heatOffset;
    if (p_heatShimmerIntensity() > 0.001) {
        let heatCol = textureSampleLevel(sceneTex, linearSampler, heatUV, 0.0).rgb;
        let groundProximity = smoothstep(0.8, 0.2, uv.y);
        let blend = p_heatShimmerIntensity() * groundProximity * 0.3;
        col = mix(col, heatCol, blend);
    }

    // Color grading — 3D LUT replaces the 6-knob chain when bound (dim > 1).
    if (textureDimensions(lut3d).x > 1u) {
        col = applyLut(col);
    } else {
        col = applyVibrance(col, p_vibrance());
        col = applySaturation(col, p_saturation());
        col = applyContrast(col, p_contrast());
        col = applyTemperatureTint(col, p_temperature(), p_tint());
        col = applyExposure(col, p_exposure());
    }

    // Nighttime (+ the semantic relight, #352: windows lit from the pre-night colour)
    let graded = col;
    col = applyNight(col, p_nightIntensity(), uv, t);
    col = semanticRelight(col, graded, uv, p_nightIntensity(), t);

    // Headlights — boosted for readable night (#171; match weather-post.wesl)
    if (p_headlightsOn() > 0.5) {
        let hlCone = headlightCone(uv, p_headlightHeading(), p_headlightPitch(), p_highBeam());
        let nightMul = mix(0.55, 1.15, p_nightIntensity());
        col = col + hlCone * nightMul * 0.85;
        col = col * (1.0 + hlCone * nightMul * 0.4);
        let beams = headlightBeams(uv, p_headlightHeading(), p_headlightPitch(), p_highBeam(), t);
        col = col + vec3<f32>(1.0, 0.95, 0.82) * beams * nightMul * 1.25;
        var fdx = uv.x - p_headlightHeading();
        if (fdx > 0.5) { fdx = fdx - 1.0; }
        if (fdx < -0.5) { fdx = fdx + 1.0; }
        let fdy = uv.y - p_headlightPitch();
        let flareDist = length(vec2<f32>(fdx, fdy));
        let flare = exp(-flareDist * flareDist * 120.0) * 0.2 * nightMul;
        col = col + vec3<f32>(1.0, 0.97, 0.88) * flare;
    }

    // Interior cabin lighting
    col = col + headlightInteriorBounce(uv, p_headlightsOn(), p_nightIntensity()) * 1.4;
    col = col + domeLightCabinGlow(uv, p_domeLightOn(), p_domeLightIntensity()) * 1.35;

    // Astronomical lighting
    col = col + sunsetHorizonGlow(uv, p_sunAzimuth(), p_sunAltitude(), p_nightIntensity());
    col = applySunrise(col, uv, p_sunrise());
    col = directionalMoonlight(col, uv, p_moonAzimuth(), p_moonAltitude(), p_nightIntensity());

    // Sky replacement (#352; no-op without the semantic map)
    col = semanticSky(col, uv, resolution.x / resolution.y, t, p_cameraHeading(), p_cameraPitch(),
        p_sunAzimuth(), p_sunAltitude(), p_moonAzimuth(), p_moonAltitude(),
        p_nightIntensity(), p_sunrise(), p_rainIntensity(), p_snowIntensity(), p_fogIntensity());

    // Atmospheric effects — fog coverage computed once, reused to attenuate
    // everything suspended in it (dust, rain, snow).
    let fogMask = semanticFog(fogAmountAt(uv, p_fogIntensity(), p_fogDensity(), p_fogHeight(), t, vec2<i32>(global_id.xy)), uv);
    col = applyFog(col, fogMask, p_fogColorIndex(), p_nightIntensity());
    col = applyVolumetricLightShafts(col, uv, p_lightShaftsIntensity(), t);
    col = applyHumidityHaze(col, uv, p_humidityHaze(), t);
    col = applyDustParticles(col, uv, p_dustIntensity() * (1.0 - fogMask * 0.8), t);
    col = applyLensFlare(col, uv, p_lensFlareIntensity());
    col = applyVignette(col, uv);

    // Weather effects (rain/snow) — fog-attenuated, night-aware darkening
    let precipVisibility = 1.0 - fogMask * 0.75;
    if (p_rainIntensity() > 0.001) {
        let r = semanticRain(rain(uv, t, panX, panY), uv) * p_rainIntensity() * precipVisibility;
        let rainTint = mix(vec3<f32>(0.78, 0.88, 1.15), vec3<f32>(0.60, 0.70, 1.02), p_nightIntensity());
        col = col + r * rainTint * (1.0 + p_headlightsOn() * p_nightIntensity() * 0.5);
        col = col * (1.0 - p_rainIntensity() * mix(0.22, 0.10, p_nightIntensity()));
        col = semanticWetRoad(col, uv, p_rainIntensity(), p_nightIntensity(), t);
    }
    if (p_snowIntensity() > 0.001) {
        let s = snow(uv, t, panX, panY) * p_snowIntensity() * precipVisibility;
        let snowLit = 1.0 + p_headlightsOn() * p_nightIntensity() * 0.35;
        col = col + s * vec3<f32>(1.15, 1.18, 1.22) * snowLit;
        col = semanticSnowCover(col, uv, p_snowIntensity(), p_nightIntensity());
    }
    let particleLayer = semanticRainParticles(applyParticlePrecipitation(vec3<f32>(0.0), uv, viewDepth), uv);
    col = col + particleLayer * precipVisibility;

    // Refractive lens droplets
    if (p_rainIntensity() > 0.05) {
        col = applyLensDroplets(col, uv, t, clamp(p_rainIntensity() * 0.8, 0.0, 1.0));
    }

    // HDR tonemapping
    col = aces_tonemap(col);

    // Dither
    let noise = fract(sin(dot(vec2<f32>(global_id.xy), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    col = col + (noise - 0.5) * 0.0025;

    // 1-frame color history + depth-reject (compute-only). Binding 9 is a 1×1
    // dummy when quality < high or prefers-reduced-motion, which no-ops this.
    col = applyTemporalHistory(col, vec2<i32>(global_id.xy), viewDepth);
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, 1.0));
}
