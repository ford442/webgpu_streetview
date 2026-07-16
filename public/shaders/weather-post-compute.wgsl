// Weather Post-Process Shader — Compute Pipeline Variant
// Compatible with image_video_effects WGSL compute pipeline
// Maps original WeatherParams into extraBuffer for cross-shader portability
//
// extraBuffer layout (indices) — must match src/renderer/weatherUniformLayout.ts,
// the WeatherParams struct in weather-post.wgsl, and WeatherPostProcessor.ts:
// 0:vibrance 1:saturation 2:contrast 3:exposure 4:temperature 5:tint
// 6:time 7:rainIntensity 8:snowIntensity 9:wind 10:speed
// 11:nightIntensity 12:headlightsOn 13:highBeam 14:headlightHeading 15:headlightPitch
// 16:domeLightOn 17:domeLightIntensity 18:sunAzimuth 19:sunAltitude 20:moonAzimuth 21:moonAltitude
// 22:fogIntensity 23:fogDensity 24:fogHeight 25:fogColorIndex 26:lightShaftsIntensity
// 27:heatShimmerIntensity 28:lensFlareIntensity 29:chromaticAberration 30:dustIntensity
// 31:humidityHaze 32:shaderEffectsEnabled 33:cameraHeading 34:cameraPitch 35:wasmNoiseEnabled
// 36:sunrise 37:anamorphicStreak 38-39:padding
//
// NOTE: the compute path does not currently bind the 64x64 WASM noise tile
// (see weather-post.wgsl's `wasmNoiseTile` storage buffer / #128), so
// wasmNoiseEnabled is read but has no effect here yet — dust cloud density
// stays uniform instead of following WASM-driven turbulence.

// --- STANDARD image_video_effects HEADER ---
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> u: Uniforms;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var dataTextureA: texture_storage_2d<rgba32float, write>;
@group(0) @binding(8) var dataTextureB: texture_storage_2d<rgba32float, write>;
@group(0) @binding(9) var dataTextureC: texture_2d<f32>;
@group(0) @binding(10) var<storage, read_write> extraBuffer: array<f32>;
@group(0) @binding(11) var comparison_sampler: sampler_comparison;
@group(0) @binding(12) var<storage, read> plasmaBuffer: array<vec4<f32>>;
// ---------------------------------------------

struct Uniforms {
  config: vec4<f32>,       // x=Time, y=Generic1, z=ResX, w=ResY
  zoom_config: vec4<f32>,  // x=ZoomTime, y=MouseX, z=MouseY, w=Generic2
  zoom_params: vec4<f32>,  // x=Param1, y=Param2, z=Param3, w=Param4
  ripples: array<vec4<f32>, 50>,
};

// ============================================================================
// extraBuffer accessors — mirror of original WeatherParams
// ============================================================================
fn ep(i: i32) -> f32 { return extraBuffer[i]; }

fn p_vibrance() -> f32     { return ep(0); }
fn p_saturation() -> f32   { return ep(1); }
fn p_contrast() -> f32     { return ep(2); }
fn p_exposure() -> f32     { return ep(3); }
fn p_temperature() -> f32  { return ep(4); }
fn p_tint() -> f32         { return ep(5); }
fn p_time() -> f32         { return ep(6); }
fn p_rainIntensity() -> f32 { return ep(7); }
fn p_snowIntensity() -> f32 { return ep(8); }
fn p_wind() -> f32         { return ep(9); }
fn p_speed() -> f32        { return max(ep(10), 0.001); }
fn p_nightIntensity() -> f32 { return ep(11); }
fn p_headlightsOn() -> f32 { return ep(12); }
fn p_highBeam() -> f32     { return ep(13); }
fn p_headlightHeading() -> f32 { return ep(14); }
fn p_headlightPitch() -> f32   { return ep(15); }
fn p_domeLightOn() -> f32      { return ep(16); }
fn p_domeLightIntensity() -> f32 { return ep(17); }
fn p_sunAzimuth() -> f32   { return ep(18); }
fn p_sunAltitude() -> f32  { return ep(19); }
fn p_moonAzimuth() -> f32  { return ep(20); }
fn p_moonAltitude() -> f32 { return ep(21); }
fn p_fogIntensity() -> f32 { return ep(22); }
fn p_fogDensity() -> f32   { return ep(23); }
fn p_fogHeight() -> f32    { return ep(24); }
fn p_fogColorIndex() -> f32 { return ep(25); }
fn p_lightShaftsIntensity() -> f32 { return ep(26); }
fn p_heatShimmerIntensity() -> f32 { return ep(27); }
fn p_lensFlareIntensity() -> f32   { return ep(28); }
fn p_chromaticAberration() -> f32  { return ep(29); }
fn p_dustIntensity() -> f32   { return ep(30); }
fn p_humidityHaze() -> f32    { return ep(31); }
fn p_shaderEffectsEnabled() -> f32 { return ep(32); }
fn p_cameraHeading() -> f32   { return ep(33); }
fn p_cameraPitch() -> f32     { return ep(34); }
fn p_wasmNoiseEnabled() -> f32 { return ep(35); }
fn p_sunrise() -> f32         { return ep(36); }
fn p_anamorphicStreak() -> f32 { return ep(37); }

// ============================================================================
// NOISE AND UTILITY FUNCTIONS
// ============================================================================

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn hash3(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn noise2D(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = hash(i);
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn noise3D(p: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = hash3(i);
    let b = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
    let c = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
    let d = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
    let e = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
    let f1 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
    let g = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
    let h = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
    return mix(
        mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
        mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
        f.z
    );
}

fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        value = value + amplitude * noise3D(p * frequency);
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }
    return value;
}

// ============================================================================
// CAMERA-AWARE COORDINATE TRANSFORMATION
// ============================================================================

fn worldAzimuthToScreenX(azimuth: f32, cameraHeadingNorm: f32) -> f32 {
    let worldNormX = fract((azimuth + 3.14159265) / (2.0 * 3.14159265));
    var screenX = worldNormX - cameraHeadingNorm + 0.5;
    return fract(screenX);
}

fn normalizedDistance(a: f32, b: f32) -> f32 {
    var d = a - b;
    if (d > 0.5) { d = d - 1.0; }
    if (d < -0.5) { d = d + 1.0; }
    return d;
}

// ============================================================================
// COLOR GRADING FUNCTIONS
// ============================================================================

fn applyVibrance(col: vec3<f32>, vibrance: f32) -> vec3<f32> {
    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let maxC = max(max(col.r, col.g), col.b);
    let sat = maxC - luma;
    return col + (col - vec3<f32>(luma)) * vibrance * (1.0 - sat);
}

fn applySaturation(col: vec3<f32>, saturation: f32) -> vec3<f32> {
    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luma), col, 1.0 + saturation);
}

fn applyContrast(col: vec3<f32>, contrast: f32) -> vec3<f32> {
    return (col - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);
}

fn applyExposure(col: vec3<f32>, exposure: f32) -> vec3<f32> {
    return col * pow(2.0, exposure);
}

fn kelvinToRGB(kelvin: f32) -> vec3<f32> {
    var rgb = vec3<f32>(255.0);
    let temp = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    if (temp > 66.0) {
        rgb.r = 329.698727446 * pow(temp - 60.0, -0.1332047592);
        rgb.r = clamp(rgb.r, 0.0, 255.0);
    }
    if (temp <= 66.0) {
        rgb.g = 99.4708025861 * log(temp) - 161.1195681661;
    } else {
        rgb.g = 288.1221695283 * pow(temp - 60.0, -0.0755148492);
    }
    rgb.g = clamp(rgb.g, 0.0, 255.0);
    if (temp < 66.0) {
        if (temp > 19.0) {
            rgb.b = 138.5177312231 * log(temp - 10.0) - 305.0447927307;
            rgb.b = clamp(rgb.b, 0.0, 255.0);
        } else {
            rgb.b = 0.0;
        }
    }
    return rgb / 255.0;
}

fn applyTemperatureTint(col: vec3<f32>, temperature: f32, tint: f32) -> vec3<f32> {
    let kelvin = 6500.0 + temperature * 5000.0;
    let kelvinRGB = kelvinToRGB(kelvin);
    let neutralRGB = kelvinToRGB(6500.0);
    var tempMult = kelvinRGB / neutralRGB;
    tempMult.g = tempMult.g * (1.0 + tint * 0.1);
    tempMult.r = tempMult.r * (1.0 + tint * 0.05);
    tempMult.b = tempMult.b * (1.0 + tint * 0.05);
    return col * tempMult;
}

// ============================================================================
// WEATHER EFFECTS: RAIN AND SNOW
// ============================================================================

fn rain(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    let rainInt = p_rainIntensity();
    let wind = p_wind();
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let layer = f32(i);
        var st = uv * vec2<f32>(1.0, 3.0 + layer * 1.5);
        let parallaxFactor = 10.0 + layer * 5.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.5;
        st.x = st.x + wind * (0.3 + layer * 0.2);
        st.y = st.y - t * (3.5 + layer * 2.2) * (0.8 + rainInt * 0.4);
        let seed = hash(vec2<f32>(floor(st.x * 42.0 + layer * 11.0), floor(st.y)));
        st.x = fract(st.x * 42.0) - 0.5 + (seed - 0.5) * 0.8;
        st.y = fract(st.y);
        let tiltAngle = atan(wind * 1.2);
        let cosT = cos(tiltAngle);
        let sinT = sin(tiltAngle);
        let stTilted = vec2<f32>(st.x * cosT - st.y * sinT, st.x * sinT + st.y * cosT);
        let streak = smoothstep(0.96, 1.0, 1.0 - length(stTilted * vec2<f32>(0.45, 3.2)));
        c = c + streak * (0.7 + seed * 0.8);
    }
    return c * 0.75;
}

fn snow(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    let wind = p_wind();
    let snowInt = p_snowIntensity();
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        var st = uv * (4.0 + layer * 3.2);
        let parallaxFactor = 8.0 + layer * 4.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.6;
        st.x = st.x + wind * (0.5 + layer * 0.25);
        st.y = st.y - t * (0.6 + layer * 0.35);
        st.x = st.x + sin(t * 1.8 + layer * 3.0 + st.y * 2.0) * 0.15;
        let id = floor(st);
        let rnd = hash(id + vec2<f32>(layer));
        st = fract(st) - vec2<f32>(0.5);
        let snowTilt = atan(wind * 0.6);
        let cosST = cos(snowTilt);
        let sinST = sin(snowTilt);
        let stTilted = vec2<f32>(st.x * cosST - st.y * sinST, st.x * sinST + st.y * cosST);
        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(stTilted));
        c = c + flake * (0.85 + rnd * 0.6);
    }
    return c * 1.35;
}

// ============================================================================
// ATMOSPHERIC EFFECTS
// ============================================================================

fn getFogColor(fogIndex: f32) -> vec3<f32> {
    let grayFog = vec3<f32>(0.75, 0.75, 0.78);
    let blueFog = vec3<f32>(0.65, 0.72, 0.85);
    let brownFog = vec3<f32>(0.72, 0.65, 0.55);
    let greenFog = vec3<f32>(0.60, 0.70, 0.60);
    let idx = i32(fogIndex);
    if (idx == 1) { return blueFog; }
    if (idx == 2) { return brownFog; }
    if (idx == 3) { return greenFog; }
    return grayFog;
}

fn applyFog(col: vec3<f32>, uv: vec2<f32>, night: f32) -> vec3<f32> {
    let intensity = p_fogIntensity();
    let density = p_fogDensity();
    if (intensity < 0.001 && density < 0.001) { return col; }
    let horizonDist = abs(uv.y - 0.5);
    let groundProximity = smoothstep(0.35, 0.0, horizonDist);
    var fogAmount = density * groundProximity;
    fogAmount = fogAmount + intensity * (0.2 + groundProximity * 0.8);
    let t = p_time() * p_speed();
    let fogUV1 = vec3<f32>(uv * 4.0 + vec2<f32>(t * 0.07, t * 0.04), t * 0.05);
    let fogUV2 = vec3<f32>(uv * 8.0 - vec2<f32>(t * 0.05, t * 0.03), t * 0.08);
    let roll = fbm(fogUV1, 2) * 0.18 + fbm(fogUV2, 2) * 0.08;
    fogAmount = fogAmount * (0.75 + roll);
    let dayFog = vec3<f32>(0.71, 0.76, 0.78);
    let nightFog = vec3<f32>(0.08, 0.12, 0.22);
    var fogColor = mix(dayFog, nightFog, clamp(night, 0.0, 1.0));
    let colorIdx = p_fogColorIndex();
    let indexedColor = getFogColor(colorIdx);
    if (colorIdx > 0.5) { fogColor = indexedColor; }
    return mix(col, fogColor, clamp(fogAmount, 0.0, 0.95));
}

fn applyVolumetricLightShafts(col: vec3<f32>, uv: vec2<f32>, t: f32) -> vec3<f32> {
    let intensity = p_lightShaftsIntensity();
    if (intensity < 0.001) { return col; }
    let sunScreenX = worldAzimuthToScreenX(p_sunAzimuth(), p_cameraHeading());
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let sunUvY = 1.0 - clamp(p_sunAltitude() / 1.5708, 0.0, 1.0);
    let dSunY = uv.y - sunUvY;
    let distFromSun = length(vec2<f32>(dSunX * 2.0, dSunY));
    let sunAbove = smoothstep(0.0, 0.1, p_sunAltitude());
    let lookingAtSun = smoothstep(0.5, 0.0, distFromSun);
    if (sunAbove * lookingAtSun < 0.001) { return col; }
    let rayCount = 8.0;
    let angle = atan2(dSunY, dSunX * 2.0);
    let rayAngle = angle * rayCount + t * 0.5;
    var rayMod = sin(rayAngle) * 0.5 + 0.5;
    rayMod = rayMod * rayMod * (3.0 - 2.0 * rayMod);
    let altitudeFactor = 1.0 - clamp(p_sunAltitude() / 0.3, 0.0, 1.0);
    let rayMod2 = sin(rayAngle * 2.0 + t * 0.3) * 0.5 + 0.5;
    let combinedRay = mix(rayMod, rayMod * rayMod2, altitudeFactor * 0.4);
    let rayFalloff = exp(-distFromSun * 3.0) * (1.0 - distFromSun * 0.5);
    let dustUV = uv * 30.0 + vec2<f32>(t * 0.2, t * 0.1);
    let dust = noise2D(dustUV) * noise2D(dustUV * 2.0 + 10.0);
    let dustParticle = pow(dust, 2.0) * 2.0;
    let shaftIntensity = intensity * sunAbove * lookingAtSun * rayFalloff * (0.6 + combinedRay * 0.4);
    let dustIntensity = intensity * sunAbove * lookingAtSun * rayFalloff * dustParticle * 0.3;
    let lightColor = vec3<f32>(1.0, 0.85, 0.6);
    return col + lightColor * shaftIntensity * 0.5 + lightColor * dustIntensity;
}

fn getHeatShimmerOffset(uv: vec2<f32>, intensity: f32, t: f32) -> vec2<f32> {
    if (intensity < 0.001) { return vec2<f32>(0.0); }
    let groundProximity = smoothstep(0.8, 0.2, uv.y);
    var offset = vec2<f32>(0.0);
    let wave1 = sin(uv.x * 20.0 + t * 2.0) * cos(uv.y * 15.0 + t * 1.5);
    offset.x = offset.x + wave1 * 0.002;
    let wave2 = sin(uv.x * 35.0 - t * 3.0) * sin(uv.y * 25.0 + t * 2.5);
    offset.y = offset.y + wave2 * 0.0015;
    let turb = noise2D(uv * 50.0 + t * 5.0) - 0.5;
    offset = offset + vec2<f32>(turb * 0.001);
    return offset * intensity * groundProximity * 2.0;
}

fn applyLensFlare(col: vec3<f32>, uv: vec2<f32>, intensity: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    let sunScreenX = worldAzimuthToScreenX(p_sunAzimuth(), p_cameraHeading());
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let sunUvY = 1.0 - clamp(p_sunAltitude() / 1.5708, 0.0, 1.0);
    let dSunY = uv.y - sunUvY;
    let sunToPixel = vec2<f32>(-dSunX, -dSunY);
    let sunDist = length(vec2<f32>(dSunX * 2.0, dSunY));
    let sunVisible = smoothstep(0.0, 0.1, p_sunAltitude());
    if (sunVisible < 0.001) { return col; }
    var flare = vec3<f32>(0.0);
    let mainGlow = exp(-sunDist * sunDist * 8.0) * 0.5;
    flare = flare + vec3<f32>(1.0, 0.95, 0.8) * mainGlow;
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let fi = f32(i);
        let ghostPos = sunToPixel * (0.4 + fi * 0.275);
        let ghostDist = length(vec2<f32>(dSunX * 2.0 + ghostPos.x * 2.0, dSunY + ghostPos.y));
        let ghostIntensities = array<f32, 5>(0.15, 0.1, 0.08, 0.05, 0.03);
        let ghost = exp(-ghostDist * ghostDist * 20.0) * ghostIntensities[i];
        let rainbowPhase = fi * 1.256;
        let ghostColor = vec3<f32>(
            0.5 + 0.5 * cos(rainbowPhase),
            0.5 + 0.5 * cos(rainbowPhase + 2.094),
            0.5 + 0.5 * cos(rainbowPhase + 4.189)
        );
        flare = flare + ghostColor * ghost;
    }
    let streak = exp(-abs(dSunY) * 10.0) * exp(-dSunX * dSunX * 2.0) * 0.08;
    flare = flare + vec3<f32>(1.0, 0.9, 0.7) * streak;
    let anamorphicStreak = p_anamorphicStreak();
    if (anamorphicStreak > 0.001) {
        let anamorphicY = exp(-dSunY * dSunY * 800.0);
        let anamorphicX = exp(-dSunX * dSunX * 0.3);
        let anamorphicColor = vec3<f32>(0.3, 0.5, 1.0);
        flare = flare + anamorphicColor * anamorphicY * anamorphicX * anamorphicStreak * sunVisible * 0.4;
    }
    return col + flare * intensity * sunVisible;
}

fn applyChromaticAberration(uv: vec2<f32>, amount: f32) -> vec3<f32> {
    if (amount < 0.001) {
        return textureSampleLevel(readTexture, u_sampler, uv, 0.0).rgb;
    }
    let center = vec2<f32>(0.5);
    let dist = length((uv - center) * vec2<f32>(2.0, 1.0));
    let edgeFactor = smoothstep(0.0, 1.0, dist);
    let aberration = amount * edgeFactor * 0.015;
    let dir = normalize(uv - center);
    let r = textureSampleLevel(readTexture, u_sampler, uv + dir * aberration, 0.0).r;
    let g = textureSampleLevel(readTexture, u_sampler, uv, 0.0).g;
    let b = textureSampleLevel(readTexture, u_sampler, uv - dir * aberration * 0.5, 0.0).b;
    return vec3<f32>(r, g, b);
}

fn applyVignette(col: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.2, 1.0));
    let vignette = 1.0 - smoothstep(0.5, 1.3, centerDist) * 0.4;
    return col * vignette;
}

fn applyDustParticles(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    var dustAccum = vec3<f32>(0.0);
    let sunScreenX = worldAzimuthToScreenX(p_sunAzimuth(), p_cameraHeading());
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let sunUvY = 1.0 - clamp(p_sunAltitude() / 1.5708, 0.0, 1.0);
    let sunDist = length(vec2<f32>(dSunX * 2.0, uv.y - sunUvY));
    let sunVisible = smoothstep(0.0, 0.1, p_sunAltitude());
    let towardSun = smoothstep(0.5, 0.0, sunDist);
    for (var i: i32 = 0; i < 3; i = i + 1) {
        let layer = f32(i);
        var particleUV = uv * (15.0 + layer * 10.0);
        particleUV.x = particleUV.x + p_wind() * (0.2 + layer * 0.1) + t * (0.1 + layer * 0.05);
        particleUV.y = particleUV.y + t * (0.05 + layer * 0.03);
        let id = floor(particleUV);
        let rnd = hash(id + vec2<f32>(layer * 13.0));
        if (rnd > 0.7) {
            let pos = fract(particleUV) - vec2<f32>(0.5);
            let dist = length(pos);
            let particle = smoothstep(0.15, 0.0, dist) * (0.5 + rnd * 0.5);
            let sparklePhase = t * (3.0 + rnd * 2.0) + layer * 5.0;
            let sparkle = pow(sin(sparklePhase) * 0.5 + 0.5, 10.0) * towardSun * sunVisible;
            let dustColor = vec3<f32>(0.9, 0.85, 0.7) + vec3<f32>(0.3, 0.25, 0.1) * sparkle;
            dustAccum = dustAccum + dustColor * particle * (0.3 + sparkle * 0.7);
        }
    }
    return col + dustAccum * intensity;
}

fn applyHumidityHaze(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    let distanceFactor = smoothstep(0.7, 0.2, uv.y);
    let hazeColor = vec3<f32>(0.75, 0.82, 0.88);
    let hazeAmount = intensity * distanceFactor * 0.4;
    let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let desaturated = mix(col, vec3<f32>(luma), intensity * distanceFactor * 0.3);
    var result = mix(desaturated, hazeColor, hazeAmount);
    let texel = 1.0 / vec2<f32>(textureDimensions(readTexture));
    let softening = intensity * distanceFactor * 0.0005;
    let n1 = textureSampleLevel(readTexture, u_sampler, uv + vec2<f32>(softening, 0.0), 0.0).rgb;
    let n2 = textureSampleLevel(readTexture, u_sampler, uv - vec2<f32>(softening, 0.0), 0.0).rgb;
    let n3 = textureSampleLevel(readTexture, u_sampler, uv + vec2<f32>(0.0, softening), 0.0).rgb;
    let n4 = textureSampleLevel(readTexture, u_sampler, uv - vec2<f32>(0.0, softening), 0.0).rgb;
    let blurred = (n1 + n2 + n3 + n4) * 0.25;
    result = mix(result, blurred, intensity * distanceFactor * 0.15);
    return result;
}

// ============================================================================
// NIGHTTIME EFFECTS
// ============================================================================

fn starField(uv: vec2<f32>, scale: f32, t: f32) -> f32 {
    let suv = uv * scale;
    let cell = floor(suv);
    let fuv = fract(suv) - vec2<f32>(0.5);
    let rnd = hash(cell * vec2<f32>(127.1, 311.7) + vec2<f32>(74.7, 29.3));
    let rnd2 = hash(cell * vec2<f32>(269.5, 183.3));
    if (rnd > 0.35) { return 0.0; }
    let offset = vec2<f32>(rnd, rnd2) - vec2<f32>(0.5);
    let dist = length(fuv - offset * 0.8);
    let starSize = 0.015 + rnd2 * 0.025;
    let star = smoothstep(starSize, starSize * 0.1, dist);
    let phase = rnd * 6.2832;
    let twinkle = 0.5 + 0.5 * sin(t * (1.5 + rnd2 * 2.5) + phase);
    return star * twinkle;
}

fn nightSky(uv: vec2<f32>, t: f32) -> vec3<f32> {
    let skyMask = smoothstep(0.45, 0.15, uv.y);
    if (skyMask < 0.001) { return vec3<f32>(0.0); }
    var stars = starField(uv, 25.0, t) * 1.0;
    stars = stars + starField(uv + vec2<f32>(13.7, 7.3), 40.0, t) * 0.6;
    stars = stars + starField(uv + vec2<f32>(31.1, 53.7), 60.0, t) * 0.3;
    let starColor = vec3<f32>(0.95, 0.95, 1.0);
    return stars * starColor * skyMask;
}

fn applyNight(col: vec3<f32>, night: f32, uv: vec2<f32>, t: f32) -> vec3<f32> {
    if (night < 0.001) { return col; }
    var c = col;
    let darkeningCurve = night * night * (3.0 - 2.0 * night);
    c = c * mix(1.0, 0.03, darkeningCurve);
    let gray = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3<f32>(gray), night * 0.7);
    let moonTint = vec3<f32>(0.08, 0.12, 0.28);
    c = c + moonTint * night * 0.08;
    let skyDarken = smoothstep(0.55, 0.05, uv.y);
    c = c * mix(1.0, 0.02, skyDarken * night);
    let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lightMask = smoothstep(0.35, 0.9, lum);
    c = c + col * lightMask * night * 0.5;
    let starBrightness = night * 2.0;
    c = c + nightSky(uv, t) * starBrightness;
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.3, 1.0));
    let nightVignette = 1.0 - smoothstep(0.3, 1.0, centerDist) * night * 0.4;
    c = c * nightVignette;
    let noise = hash(uv * 500.0 + t * 0.1);
    c = c + (noise - 0.5) * 0.01 * night;
    return max(c, vec3<f32>(0.001));
}

fn headlightCone(uv: vec2<f32>, hlHeading: f32, hlPitch: f32, highBeam: f32) -> vec3<f32> {
    var dx = uv.x - hlHeading;
    if (dx > 0.5) { dx = dx - 1.0; }
    if (dx < -0.5) { dx = dx + 1.0; }
    let dy = uv.y - hlPitch;
    let yawWidth = mix(0.08, 0.14, highBeam);
    let pitchWidth = mix(0.12, 0.20, highBeam);
    let angX = dx / yawWidth;
    let angY = dy / pitchWidth;
    let dist = angX * angX + angY * angY;
    let cone = exp(-dist * 2.5);
    let downBias = smoothstep(-0.15, 0.15, dy);
    let coneFinal = cone * mix(1.0, 0.3, downBias);
    let warmColor = vec3<f32>(1.0, 0.92, 0.75);
    let centerIntensity = exp(-dist * 8.0);
    let hotSpot = vec3<f32>(1.0, 0.98, 0.9) * centerIntensity * 0.5;
    let strength = mix(0.7, 1.2, highBeam);
    return (warmColor * coneFinal * strength + hotSpot);
}

fn headlightBeams(uv: vec2<f32>, hlHeading: f32, hlPitch: f32, highBeam: f32, t: f32) -> f32 {
    var dx = uv.x - hlHeading;
    if (dx > 0.5) { dx = dx - 1.0; }
    if (dx < -0.5) { dx = dx + 1.0; }
    let dy = uv.y - hlPitch;
    let beamWidth = mix(0.06, 0.10, highBeam);
    let angX = dx / beamWidth;
    let angY = dy / 0.25;
    let dist = angX * angX + angY * angY * 0.3;
    let beam = exp(-dist * 3.0);
    let noiseUV = uv * vec2<f32>(50.0, 30.0) + vec2<f32>(t * 0.3, t * 0.1);
    let n = hash(floor(noiseUV)) * 0.3 + 0.7;
    return beam * n * mix(0.12, 0.25, highBeam);
}

fn headlightInteriorBounce(uv: vec2<f32>, hlOn: f32, night: f32) -> vec3<f32> {
    if (hlOn < 0.5 || night < 0.01) { return vec3<f32>(0.0); }
    let bottomGrad = smoothstep(0.30, 0.0, uv.y);
    return vec3<f32>(1.0, 0.58, 0.18) * bottomGrad * night * 0.12;
}

fn domeLightCabinGlow(uv: vec2<f32>, domeOn: f32, domeIntensity: f32) -> vec3<f32> {
    if (domeOn < 0.5 || domeIntensity < 0.01) { return vec3<f32>(0.0); }
    let topGrad = smoothstep(0.25, 0.0, 1.0 - uv.y);
    let cx = uv.x - 0.5;
    let hFade = exp(-cx * cx * 8.0);
    return vec3<f32>(1.0, 0.91, 0.71) * topGrad * hFade * domeIntensity * 0.06;
}

const GOLDEN_HOUR_RANGE: f32 = 0.105;

fn sunsetHorizonGlow(uv: vec2<f32>, sunAz: f32, sunAlt: f32, night: f32) -> vec3<f32> {
    let altFactor = 1.0 - clamp(abs(sunAlt) / GOLDEN_HOUR_RANGE, 0.0, 1.0);
    let nightFade = 1.0 - clamp(night / 0.85, 0.0, 1.0);
    let strength  = altFactor * nightFade;
    if (strength < 0.002) { return vec3<f32>(0.0); }
    let sunScreenX = worldAzimuthToScreenX(sunAz, p_cameraHeading());
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let hFade = smoothstep(0.33, 0.0, abs(dSunX));
    let vertGrad = smoothstep(0.80, 0.30, uv.y);
    let goldenColor  = vec3<f32>(1.0, 0.72, 0.35);
    let reddishColor = vec3<f32>(0.95, 0.35, 0.12);
    let sunsetColor  = mix(goldenColor, reddishColor, smoothstep(0.40, 0.60, uv.y));
    let glow = sunsetColor * vertGrad * hFade * strength;
    return glow * (1.0 + glow * 0.5) + glow * 0.2;
}

fn applySunrise(col: vec3<f32>, uv: vec2<f32>, sunrise: f32) -> vec3<f32> {
    if (sunrise < 0.001) { return col; }
    let horizonGlow = smoothstep(0.5, 0.0, uv.y);
    let warmHighlight = vec3<f32>(1.0, 0.65, 0.35) * horizonGlow * sunrise * 0.4;
    let shadowTint = mix(vec3<f32>(0.72, 0.58, 0.85), vec3<f32>(0.35, 0.45, 0.82), uv.y);
    let shadowMask = (1.0 - horizonGlow) * sunrise * 0.18;
    var result = col + warmHighlight;
    result = result + shadowTint * shadowMask;
    let goldBoost = vec3<f32>(0.15, 0.05, -0.05) * horizonGlow * sunrise;
    result = result + goldBoost;
    return result;
}

fn directionalMoonlight(col: vec3<f32>, uv: vec2<f32>, moonAz: f32, moonAlt: f32, night: f32) -> vec3<f32> {
    let moonAbove = clamp(moonAlt / 0.8, 0.0, 1.0);
    let strength  = moonAbove * clamp((night - 0.4) / 0.6, 0.0, 1.0);
    if (strength < 0.002) { return col; }
    let moonColor = vec3<f32>(0.72, 0.82, 1.0);
    let moonScreenX = worldAzimuthToScreenX(moonAz, p_cameraHeading());
    let dMoonX = normalizedDistance(uv.x, moonScreenX);
    let moonUvY = 1.0 - clamp(moonAlt / 1.5708, 0.0, 1.0);
    let moonDist = length(vec2<f32>(dMoonX * 2.5, uv.y - moonUvY));
    let specular  = exp(-moonDist * moonDist * 35.0) * 0.15 * strength;
    let skyGrad = smoothstep(0.55, 0.15, uv.y);
    let ambient = moonColor * skyGrad * strength * 0.04;
    let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let lumTint = moonColor * smoothstep(0.3, 0.85, lum) * strength * 0.06;
    return col + ambient + moonColor * specular + lumTint;
}

// ============================================================================
// REFRACTIVE LENS DROPLETS
// ============================================================================

fn applyLensDroplets(col: vec3<f32>, uv: vec2<f32>, t: f32, intensity: f32) -> vec3<f32> {
    if (intensity < 0.05) { return col; }
    var result = col;
    let aspect = 16.0 / 9.0;
    for (var i: i32 = 0; i < 8; i = i + 1) {
        let fi = f32(i);
        let seed  = hash(vec2<f32>(fi * 17.3, fi * 5.7 + 3.1));
        let seed2 = hash(vec2<f32>(fi * 29.1, fi * 11.3));
        let seed3 = hash(vec2<f32>(fi * 43.7, fi * 7.9 + 1.5));
        let cx = seed * 0.8 + 0.1;
        let cy = fract(seed2 + t * (0.015 + seed3 * 0.01));
        let dropPos = vec2<f32>(cx, cy);
        let r = 0.03 + seed * 0.04;
        let dist = length((uv - dropPos) * vec2<f32>(aspect, 1.0));
        if (dist < r) {
            let refractDir = normalize((uv - dropPos) * vec2<f32>(aspect, 1.0));
            let refractStr = (1.0 - dist / r) * 0.03 * intensity;
            let lensUV = clamp(uv + refractDir * refractStr, vec2<f32>(0.001), vec2<f32>(0.999));
            let refracted = textureSampleLevel(readTexture, u_sampler, lensUV, 0.0).rgb;
            let interior = smoothstep(r, r * 0.5, dist);
            result = mix(result, refracted, interior * 0.65);
            let rim = smoothstep(r, r * 0.88, dist) - smoothstep(r * 0.88, r * 0.70, dist);
            result = result + vec3<f32>(0.9, 0.95, 1.0) * rim * 0.35 * intensity;
        }
    }
    return result;
}

// ============================================================================
// HDR TONEMAPPING
// ============================================================================

fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ============================================================================
// MAIN COMPUTE SHADER
// ============================================================================

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
        return;
    }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let t = p_time() * p_speed();

    // Bypass mode
    if (p_shaderEffectsEnabled() < 0.5) {
        let raw = textureSampleLevel(readTexture, u_sampler, uv, 0.0).rgb;
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(raw, 1.0));
        return;
    }

    let panX = p_cameraHeading() - 0.5;
    let panY = p_cameraPitch() - 0.5;

    // Chromatic aberration
    var col = applyChromaticAberration(uv, p_chromaticAberration());

    // Heat shimmer
    let heatOffset = getHeatShimmerOffset(uv, p_heatShimmerIntensity(), t);
    let heatUV = uv + heatOffset;
    if (p_heatShimmerIntensity() > 0.001) {
        let heatCol = textureSampleLevel(readTexture, u_sampler, heatUV, 0.0).rgb;
        let groundProximity = smoothstep(0.8, 0.2, uv.y);
        let blend = p_heatShimmerIntensity() * groundProximity * 0.3;
        col = mix(col, heatCol, blend);
    }

    // Color grading
    col = applyVibrance(col, p_vibrance());
    col = applySaturation(col, p_saturation());
    col = applyContrast(col, p_contrast());
    col = applyTemperatureTint(col, p_temperature(), p_tint());
    col = applyExposure(col, p_exposure());

    // Nighttime
    col = applyNight(col, p_nightIntensity(), uv, t);

    // Headlights
    if (p_headlightsOn() > 0.5) {
        let hlCone = headlightCone(uv, p_headlightHeading(), p_headlightPitch(), p_highBeam());
        let nightMul = mix(0.4, 1.0, p_nightIntensity());
        col = col + hlCone * nightMul * 0.6;
        col = col * (1.0 + hlCone * nightMul * 0.3);
        let beams = headlightBeams(uv, p_headlightHeading(), p_headlightPitch(), p_highBeam(), t);
        col = col + vec3<f32>(1.0, 0.95, 0.82) * beams * nightMul;
        var fdx = uv.x - p_headlightHeading();
        if (fdx > 0.5) { fdx = fdx - 1.0; }
        if (fdx < -0.5) { fdx = fdx + 1.0; }
        let fdy = uv.y - p_headlightPitch();
        let flareDist = length(vec2<f32>(fdx, fdy));
        let flare = exp(-flareDist * flareDist * 120.0) * 0.15 * nightMul;
        col = col + vec3<f32>(1.0, 0.97, 0.88) * flare;
    }

    // Interior cabin lighting
    col = col + headlightInteriorBounce(uv, p_headlightsOn(), p_nightIntensity());
    col = col + domeLightCabinGlow(uv, p_domeLightOn(), p_domeLightIntensity());

    // Astronomical lighting
    col = col + sunsetHorizonGlow(uv, p_sunAzimuth(), p_sunAltitude(), p_nightIntensity());
    col = applySunrise(col, uv, p_sunrise());
    col = directionalMoonlight(col, uv, p_moonAzimuth(), p_moonAltitude(), p_nightIntensity());

    // Atmospheric effects
    col = applyFog(col, uv, p_nightIntensity());
    col = applyVolumetricLightShafts(col, uv, p_lightShaftsIntensity(), t);
    col = applyHumidityHaze(col, uv, p_humidityHaze(), t);
    col = applyDustParticles(col, uv, p_dustIntensity(), t);
    col = applyLensFlare(col, uv, p_lensFlareIntensity());
    col = applyVignette(col, uv);

    // Weather effects (rain/snow)
    if (p_rainIntensity() > 0.001) {
        let r = rain(uv, t, panX, panY) * p_rainIntensity();
        col = col + r * vec3<f32>(0.78, 0.88, 1.15);
        col = col * (1.0 - p_rainIntensity() * 0.22);
    }
    if (p_snowIntensity() > 0.001) {
        let s = snow(uv, t, panX, panY) * p_snowIntensity();
        col = col + s * vec3<f32>(1.15, 1.18, 1.22);
    }

    // Refractive lens droplets
    if (p_rainIntensity() > 0.05) {
        col = applyLensDroplets(col, uv, t, clamp(p_rainIntensity() * 0.8, 0.0, 1.0));
    }

    // HDR tonemapping
    col = aces_tonemap(col);

    // Dither
    let noise = fract(sin(dot(vec2<f32>(global_id.xy), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    col = col + (noise - 0.5) * 0.0025;

    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, 1.0));
}
