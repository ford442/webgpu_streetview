// Weather Post-Process Shader
// Dual-pass HDR weather effects: rain streaks + snow flakes + nighttime + headlights
// 100% procedural, no textures, runs in rgba16float HDR
// NEW: Atmospheric effects - fog, light shafts, heat shimmer, lens effects, dust, humidity

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
}

@group(0) @binding(0) var<uniform> p: WeatherParams;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
// CPU-computed Perlin noise tile (src/wasm/wasmNoiseFeeder.ts), refreshed
// every ~30 frames via device.queue.writeBuffer — a coarser, more organic
// alternative to the per-pixel GPU hash noise used elsewhere in this file.
@group(0) @binding(3) var<storage, read> wasmNoiseTile: array<f32, 4096>;

// 3D film LUT (group 1). A 1×1×1 dummy means identity — skip sampling so
// default ACES pixels stay bit-identical to the pre-LUT path.
@group(1) @binding(0) var lut3d: texture_3d<f32>;
@group(1) @binding(1) var lutSampler: sampler;

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

// ============================================================================
// CAMERA-AWARE COORDINATE TRANSFORMATION
// ============================================================================

// Convert world azimuth (radians, SunCalc: 0=S, π/2=W, π=N, -π/2=E) 
// to screen-space X coordinate (0-1), accounting for camera heading.
// This ensures sun/moon appear at correct on-screen positions when panning.
fn worldAzimuthToScreenX(azimuth: f32, cameraHeadingNorm: f32) -> f32 {
    // Normalize azimuth to 0-1 range (same as original sunNormX calculation)
    let worldNormX = fract((azimuth + 3.14159265) / (2.0 * 3.14159265));
    // Offset by camera heading to get screen position
    var screenX = worldNormX - cameraHeadingNorm + 0.5;
    // Wrap to 0-1 range
    return fract(screenX);
}

// Get the shortest signed distance between two normalized coordinates (0-1)
fn normalizedDistance(a: f32, b: f32) -> f32 {
    var d = a - b;
    if (d > 0.5) { d = d - 1.0; }
    if (d < -0.5) { d = d + 1.0; }
    return d;
}

// ============================================================================
// CHEAP DEPTH PROXY (no depth buffer — Street View gives us none)
// ============================================================================
// The panorama is a sphere around the eye, so screen Y alone tells us a lot:
// everything above the horizon line is effectively at infinity (sky/skyline),
// and ground pixels below it get closer as they approach the bottom of the
// frame. `viewHorizonY` tracks where that line sits as the camera pitches.
//
// Kept byte-identical with weather-post-compute.wgsl — see the parity guard in
// src/renderer/weatherShaderParity.test.ts.

// Screen-space Y (top-origin, 0-1) of the horizon for a normalized camera
// pitch (0.5 = level). ~90 degree vertical FOV => 1 pitch unit ~ 2 screens.
fn viewHorizonY(cameraPitchNorm: f32) -> f32 {
    return clamp(0.5 + (cameraPitchNorm - 0.5) * 2.0, -0.75, 1.75);
}

// Normalized view distance: 0 = right in front of the camera, 1 = horizon or
// beyond. Hyperbolic falloff below the horizon approximates eyeHeight/tan(angle).
fn viewDepthProxy(uv: vec2<f32>, horizonY: f32) -> f32 {
    let below = uv.y - horizonY;
    if (below <= 0.0) { return 1.0; }
    return clamp(0.06 / max(below, 0.0025), 0.0, 1.0);
}

// Vertical density profile of a fog layer. `height` 0 keeps the bank hugging
// the ground (dense at the horizon line, thinning upward); 1 lifts it into an
// elevated haze band that leaves the road clear.
fn fogHeightFalloff(uv: vec2<f32>, horizonY: f32, height: f32) -> f32 {
    let altitude = clamp((horizonY - uv.y) / max(horizonY, 0.15), 0.0, 1.0);
    let ground   = exp(-altitude * 3.2);
    let elevated = smoothstep(0.0, 0.5, altitude) * exp(-max(altitude - 0.5, 0.0) * 2.4);
    return mix(ground, elevated, clamp(height, 0.0, 1.0));
}

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

fn applyLut(color: vec3<f32>) -> vec3<f32> {
    let dim = textureDimensions(lut3d).x;
    if (dim <= 1u) {
        return color;
    }
    let n = f32(dim);
    let uvw = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    let uvwC = (uvw * (n - 1.0) + vec3<f32>(0.5)) / n;
    return textureSampleLevel(lut3d, lutSampler, uvwC, 0.0).rgb;
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
// WEATHER EFFECTS: RAIN AND SNOW (World-Space with Camera Panning)
// ============================================================================

// Improved rain with camera panning support for world-space effect
fn rain(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let layer = f32(i);
        var st = uv * vec2<f32>(1.0, 3.0 + layer * 1.5);
        
        // Offset by camera pan to make rain feel like it's in world space
        // Closer layers (lower i) move more than distant ones (parallax)
        let parallaxFactor = 10.0 + layer * 5.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.5; // Less vertical parallax
        
        st.x = st.x + p.wind * (0.3 + layer * 0.2);
        st.y = st.y - t * (3.5 + layer * 2.2) * (0.8 + p.rainIntensity * 0.4);

        let seed = hash(vec2<f32>(floor(st.x * 42.0 + layer * 11.0), floor(st.y)));
        st.x = fract(st.x * 42.0) - 0.5 + (seed - 0.5) * 0.8;
        st.y = fract(st.y);

        // Rotate streak axis to match wind direction — aggressive slant at high wind
        let tiltAngle = atan(p.wind * 1.2);
        let cosT = cos(tiltAngle);
        let sinT = sin(tiltAngle);
        let stTilted = vec2<f32>(st.x * cosT - st.y * sinT, st.x * sinT + st.y * cosT);
        let streak = smoothstep(0.96, 1.0, 1.0 - length(stTilted * vec2<f32>(0.45, 3.2)));
        c = c + streak * (0.7 + seed * 0.8);
    }
    return c * 0.75;
}

// Improved snow with camera panning support for world-space effect
fn snow(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        var st = uv * (4.0 + layer * 3.2);
        
        // Offset by camera pan to make snow feel like it's in world space
        // Each layer has different parallax depth for 3D feel
        let parallaxFactor = 8.0 + layer * 4.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.6;
        
        st.x = st.x + p.wind * (0.5 + layer * 0.25);
        st.y = st.y - t * (0.6 + layer * 0.35);
        st.x = st.x + sin(t * 1.8 + layer * 3.0 + st.y * 2.0) * 0.15;

        let id = floor(st);
        let rnd = hash(id + vec2<f32>(layer));
        st = fract(st) - vec2<f32>(0.5);

        // Gently tilt snowflake placement with wind — softer factor than rain
        let snowTilt = atan(p.wind * 0.6);
        let cosST = cos(snowTilt);
        let sinST = sin(snowTilt);
        let stTilted = vec2<f32>(st.x * cosST - st.y * sinST, st.x * sinST + st.y * cosST);
        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(stTilted));
        c = c + flake * (0.85 + rnd * 0.6);
    }
    return c * 1.35;
}

// ============================================================================
// NEW ATMOSPHERIC EFFECTS
// ============================================================================

// === 1. FOG/MIST EFFECT ===
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

// Fog coverage at a pixel, 0-1. Split out from applyFog so the same value can
// attenuate rain, snow and dust — particles seen *through* fog have to fade
// with it, otherwise streaks punch through a wall of mist (the single biggest
// cohesion break in the old presets).
//
// `density` is an extinction coefficient integrated along the depth proxy
// (Beer-Lambert), `intensity` is a flat screen-wide aerial wash. packWeatherParams
// now feeds those two different numbers instead of the same slider twice.
fn fogAmountAt(uv: vec2<f32>, intensity: f32, density: f32, height: f32, t: f32) -> f32 {
    if (intensity < 0.001 && density < 0.001) { return 0.0; }

    let horizonY = viewHorizonY(p.cameraPitch);
    let depth = viewDepthProxy(uv, horizonY);
    let profile = fogHeightFalloff(uv, horizonY, height);

    // Animated fractal fog: two fbm layers scrolling at different speeds/directions
    // create a "rolling" volumetric appearance instead of a static wash
    let fogUV1 = vec3<f32>(uv * 4.0 + vec2<f32>(t * 0.07, t * 0.04), t * 0.05);
    let fogUV2 = vec3<f32>(uv * 8.0 - vec2<f32>(t * 0.05, t * 0.03), t * 0.08);
    let roll = fbm(fogUV1, 2) * 0.18 + fbm(fogUV2, 2) * 0.08;

    let sigma = density * 2.6 * profile * (0.78 + roll);
    var fogAmount = 1.0 - exp(-sigma * (0.12 + depth * 1.9));
    fogAmount = fogAmount + intensity * (0.25 + profile * 0.75) * (0.78 + roll);
    return clamp(fogAmount, 0.0, 0.95);
}

fn applyFog(col: vec3<f32>, fogAmount: f32, colorIdx: f32, night: f32) -> vec3<f32> {
    if (fogAmount < 0.001) { return col; }

    // Day fog: #b5c1c8, Night fog: dark blue
    let dayFog = vec3<f32>(0.71, 0.76, 0.78);
    let nightFog = vec3<f32>(0.08, 0.12, 0.22);
    var fogColor = mix(dayFog, nightFog, clamp(night, 0.0, 1.0));

    // Override with indexed fog color if non-zero index
    let indexedColor = getFogColor(colorIdx);
    if (colorIdx > 0.5) { fogColor = mix(indexedColor, nightFog, clamp(night, 0.0, 1.0) * 0.6); }

    return mix(col, fogColor, fogAmount);
}

// === 2. VOLUMETRIC LIGHT SHAFTS (Camera-Aware) ===
fn applyVolumetricLightShafts(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    
    // Use camera-aware coordinate transformation
    let sunScreenX = worldAzimuthToScreenX(p.sunAzimuth, p.cameraHeading);
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    
    let sunUvY = 1.0 - clamp(p.sunAltitude / 1.5708, 0.0, 1.0);
    let dSunY = uv.y - sunUvY;
    
    let distFromSun = length(vec2<f32>(dSunX * 2.0, dSunY));
    
    let sunAbove = smoothstep(0.0, 0.1, p.sunAltitude);
    let lookingAtSun = smoothstep(0.5, 0.0, distFromSun);
    
    if (sunAbove * lookingAtSun < 0.001) { return col; }
    
    let rayCount = 8.0;
    let angle = atan2(dSunY, dSunX * 2.0);
    let rayAngle = angle * rayCount + t * 0.5;
    
    var rayMod = sin(rayAngle) * 0.5 + 0.5;
    rayMod = rayMod * rayMod * (3.0 - 2.0 * rayMod);

    // Near-horizon enhancement: second harmonic intensifies crepuscular rays at low sun angles
    let altitudeFactor = 1.0 - clamp(p.sunAltitude / 0.3, 0.0, 1.0);
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

// === 3. HEAT SHIMMER ===
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

fn applyHeatShimmer(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    
    let offset = getHeatShimmerOffset(uv, intensity, t);
    let shimmerUV = uv + offset;
    let shimmerCol = textureSample(sceneTex, linearSampler, shimmerUV).rgb;
    
    let groundProximity = smoothstep(0.8, 0.2, uv.y);
    let blend = intensity * groundProximity * 0.3;
    
    return mix(col, shimmerCol, blend);
}

// === 4. LENS EFFECTS (Camera-Aware) ===
fn applyLensFlare(col: vec3<f32>, uv: vec2<f32>, intensity: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    
    // Use camera-aware coordinate transformation
    let sunScreenX = worldAzimuthToScreenX(p.sunAzimuth, p.cameraHeading);
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    
    let sunUvY = 1.0 - clamp(p.sunAltitude / 1.5708, 0.0, 1.0);
    let dSunY = uv.y - sunUvY;
    
    let sunToPixel = vec2<f32>(-dSunX, -dSunY);
    let sunDist = length(vec2<f32>(dSunX * 2.0, dSunY));
    
    let sunVisible = smoothstep(0.0, 0.1, p.sunAltitude);
    if (sunVisible < 0.001) { return col; }
    
    var flare = vec3<f32>(0.0);
    
    let mainGlow = exp(-sunDist * sunDist * 8.0) * 0.5;
    flare = flare + vec3<f32>(1.0, 0.95, 0.8) * mainGlow;
    
    // Ghost reflections
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

    // Anamorphic horizontal streak — characteristic blue bar of cinema lenses
    if (p.anamorphicStreak > 0.001) {
        let anamorphicY = exp(-dSunY * dSunY * 800.0);    // extremely thin vertically
        let anamorphicX = exp(-dSunX * dSunX * 0.3);       // wide horizontal spread
        let anamorphicColor = vec3<f32>(0.3, 0.5, 1.0);    // blue-tinted anamorphic character
        flare = flare + anamorphicColor * anamorphicY * anamorphicX * p.anamorphicStreak * sunVisible * 0.4;
    }

    return col + flare * intensity * sunVisible;
}

fn applyChromaticAberration(uv: vec2<f32>, amount: f32) -> vec3<f32> {
    if (amount < 0.001) { 
        return textureSample(sceneTex, linearSampler, uv).rgb; 
    }
    
    let center = vec2<f32>(0.5);
    let dist = length((uv - center) * vec2<f32>(2.0, 1.0));
    
    let edgeFactor = smoothstep(0.0, 1.0, dist);
    let aberration = amount * edgeFactor * 0.015;
    
    let dir = normalize(uv - center);
    
    let r = textureSample(sceneTex, linearSampler, uv + dir * aberration).r;
    let g = textureSample(sceneTex, linearSampler, uv).g;
    let b = textureSample(sceneTex, linearSampler, uv - dir * aberration * 0.5).b;
    
    return vec3<f32>(r, g, b);
}

fn applyVignette(col: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.2, 1.0));
    let vignette = 1.0 - smoothstep(0.5, 1.3, centerDist) * 0.4;
    return col * vignette;
}

// Bilinear sample of the 64x64 WASM-computed Perlin noise tile (binding 3).
// Refreshed roughly every 30 frames on the CPU — a coarser, slower-drifting
// alternative to the per-pixel GPU hash noise used elsewhere in this file.
fn sampleWasmNoiseTile(uv: vec2<f32>) -> f32 {
    let tileSize = 64.0;
    let scaled = fract(uv) * tileSize;
    let x0 = i32(floor(scaled.x)) & 63;
    let y0 = i32(floor(scaled.y)) & 63;
    let x1 = (x0 + 1) & 63;
    let y1 = (y0 + 1) & 63;
    let fx = fract(scaled.x);
    let fy = fract(scaled.y);
    let v00 = wasmNoiseTile[y0 * 64 + x0];
    let v10 = wasmNoiseTile[y0 * 64 + x1];
    let v01 = wasmNoiseTile[y1 * 64 + x0];
    let v11 = wasmNoiseTile[y1 * 64 + x1];
    return mix(mix(v00, v10, fx), mix(v01, v11, fx), fy);
}

// === 5. DUST/POLLEN PARTICLES (Camera-Aware) ===
fn applyDustParticles(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }

    var dustAccum = vec3<f32>(0.0);

    // Pre-calculate sun screen position for sparkle effect
    let sunScreenX = worldAzimuthToScreenX(p.sunAzimuth, p.cameraHeading);
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let sunUvY = 1.0 - clamp(p.sunAltitude / 1.5708, 0.0, 1.0);
    let sunDist = length(vec2<f32>(dSunX * 2.0, uv.y - sunUvY));
    let sunVisible = smoothstep(0.0, 0.1, p.sunAltitude);
    let towardSun = smoothstep(0.5, 0.0, sunDist);

    // WASM-driven cloud density: slow drifting turbulence sampled from the
    // CPU-computed noise tile, so dust motes clump into organic patches
    // instead of being uniformly distributed. Disable with ?wasmNoise=off
    // to compare against the plain per-pixel randomness below.
    var cloudDensity = 1.0;
    if (p.wasmNoiseEnabled > 0.5) {
        let cloudUV = uv * 1.5 + vec2<f32>(t * 0.015, t * 0.008);
        cloudDensity = 0.35 + 0.65 * (0.5 + 0.5 * sampleWasmNoiseTile(cloudUV));
    }

    for (var i: i32 = 0; i < 3; i = i + 1) {
        let layer = f32(i);

        var particleUV = uv * (15.0 + layer * 10.0);
        particleUV.x = particleUV.x + p.wind * (0.2 + layer * 0.1) + t * (0.1 + layer * 0.05);
        particleUV.y = particleUV.y + t * (0.05 + layer * 0.03);

        let id = floor(particleUV);
        let rnd = hash(id + vec2<f32>(layer * 13.0));

        if (rnd > 0.7) {
            let pos = fract(particleUV) - vec2<f32>(0.5);
            let dist = length(pos);

            let particle = smoothstep(0.15, 0.0, dist) * (0.5 + rnd * 0.5) * cloudDensity;

            let sparklePhase = t * (3.0 + rnd * 2.0) + layer * 5.0;
            let sparkle = pow(sin(sparklePhase) * 0.5 + 0.5, 10.0) * towardSun * sunVisible;

            let dustColor = vec3<f32>(0.9, 0.85, 0.7) + vec3<f32>(0.3, 0.25, 0.1) * sparkle;
            dustAccum = dustAccum + dustColor * particle * (0.3 + sparkle * 0.7);
        }
    }
    
    return col + dustAccum * intensity;
}

// === 6. HUMIDITY HAZE ===
fn applyHumidityHaze(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    
    let distanceFactor = smoothstep(0.7, 0.2, uv.y);
    
    let hazeColor = vec3<f32>(0.75, 0.82, 0.88);
    let hazeAmount = intensity * distanceFactor * 0.4;
    
    let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let desaturated = mix(col, vec3<f32>(luma), intensity * distanceFactor * 0.3);
    
    var result = mix(desaturated, hazeColor, hazeAmount);
    
    let texel = 1.0 / vec2<f32>(textureDimensions(sceneTex));
    let softening = intensity * distanceFactor * 0.0005;
    
    let n1 = textureSample(sceneTex, linearSampler, uv + vec2<f32>(softening, 0.0)).rgb;
    let n2 = textureSample(sceneTex, linearSampler, uv - vec2<f32>(softening, 0.0)).rgb;
    let n3 = textureSample(sceneTex, linearSampler, uv + vec2<f32>(0.0, softening)).rgb;
    let n4 = textureSample(sceneTex, linearSampler, uv - vec2<f32>(0.0, softening)).rgb;
    
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

// === READABLE NIGHT (epic #171) ===
// Dark enough to read as night, but road + UI stay visible with headlights/dome.
// Floors match src/car/carSpatialModel.ts (NIGHT_BASE_FLOOR / NIGHT_SKY_FLOOR).
fn applyNight(col: vec3<f32>, night: f32, uv: vec2<f32>, t: f32) -> vec3<f32> {
    if (night < 0.001) { return col; }
    var c = col;

    // Smoothstep curve toward a readable floor (~14% daylight), not crushed black.
    let darkeningCurve = night * night * (3.0 - 2.0 * night);
    c = c * mix(1.0, 0.14, darkeningCurve);

    // Mild desaturation for moonlight (was 0.7 — too grey/flat).
    let gray = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3<f32>(gray), night * 0.55);

    // Cool blue moonlight tint
    let moonTint = vec3<f32>(0.10, 0.14, 0.28);
    c = c + moonTint * night * 0.10;

    // Sky darkens more than the road, but stays above a readable floor (~18%).
    let skyDarken = smoothstep(0.55, 0.05, uv.y);
    c = c * mix(1.0, 0.18, skyDarken * night);

    // Preserve bright lights (streetlights, windows, signs)
    let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lightMask = smoothstep(0.28, 0.85, lum);
    c = c + col * lightMask * night * 0.65;

    // Stars against the darker sky
    let starBrightness = night * 1.6;
    c = c + nightSky(uv, t) * starBrightness;

    // Gentle vignette (was 0.4 — too heavy with the old crush)
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.3, 1.0));
    let nightVignette = 1.0 - smoothstep(0.35, 1.05, centerDist) * night * 0.28;
    c = c * nightVignette;

    let noise = hash(uv * 500.0 + t * 0.1);
    c = c + (noise - 0.5) * 0.008 * night;

    // Floor prevents pure black even without headlights
    return max(c, vec3<f32>(0.008));
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

    // Use camera-aware coordinate transformation
    let sunScreenX = worldAzimuthToScreenX(sunAz, p.cameraHeading);
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let hFade = smoothstep(0.33, 0.0, abs(dSunX));

    let vertGrad = smoothstep(0.80, 0.30, uv.y);

    let goldenColor  = vec3<f32>(1.0, 0.72, 0.35);
    let reddishColor = vec3<f32>(0.95, 0.35, 0.12);
    let sunsetColor  = mix(goldenColor, reddishColor, smoothstep(0.40, 0.60, uv.y));

    let glow = sunsetColor * vertGrad * hFade * strength;
    return glow * (1.0 + glow * 0.5) + glow * 0.2;
}

// Sunrise wash. Anchored to the *tracked* horizon line and the sun's actual
// screen azimuth so it pans with the camera exactly like sunsetHorizonGlow —
// previously it was pinned to uv.y 0.5 and ignored heading entirely, which made
// dawn light stay glued to the same corner of the screen while you turned.
fn applySunrise(col: vec3<f32>, uv: vec2<f32>, sunrise: f32) -> vec3<f32> {
    if (sunrise < 0.001) { return col; }

    let horizonY = viewHorizonY(p.cameraPitch);
    let sunScreenX = worldAzimuthToScreenX(p.sunAzimuth, p.cameraHeading);
    let dSunX = normalizedDistance(uv.x, sunScreenX);

    // Warm light concentrates around the sun's bearing, cool shadow fills the
    // opposite half of the sky.
    let towardSun = smoothstep(0.45, 0.0, abs(dSunX));
    let horizonGlow = smoothstep(horizonY + 0.12, horizonY - 0.38, uv.y);
    let warmHighlight = vec3<f32>(1.0, 0.65, 0.35) * horizonGlow * towardSun * sunrise * 0.42;

    let shadowTint = mix(vec3<f32>(0.72, 0.58, 0.85), vec3<f32>(0.35, 0.45, 0.82), uv.y);
    let shadowMask = (1.0 - horizonGlow * towardSun) * sunrise * 0.14;

    var result = col + warmHighlight;
    result = result + shadowTint * shadowMask;

    // Pink/gold color grading boost, strongest looking into the dawn
    let goldBoost = vec3<f32>(0.15, 0.05, -0.05) * horizonGlow * towardSun * sunrise;
    result = result + goldBoost;

    return result;
}

fn directionalMoonlight(col: vec3<f32>, uv: vec2<f32>, moonAz: f32, moonAlt: f32, night: f32) -> vec3<f32> {
    let moonAbove = clamp(moonAlt / 0.8, 0.0, 1.0);
    let strength  = moonAbove * clamp((night - 0.4) / 0.6, 0.0, 1.0);
    if (strength < 0.002) { return col; }

    let moonColor = vec3<f32>(0.72, 0.82, 1.0);

    // Use camera-aware coordinate transformation
    let moonScreenX = worldAzimuthToScreenX(moonAz, p.cameraHeading);
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

// Simulates water droplets accumulated on the camera lens / windshield glass.
// Each droplet acts as a tiny convex lens: it refracts (distorts) the background
// behind it, creating a magnified and inverted patch of the scene.
// Triggered by rainIntensity — no additional uniform required.
fn applyLensDroplets(col: vec3<f32>, uv: vec2<f32>, t: f32, intensity: f32) -> vec3<f32> {
    if (intensity < 0.05) { return col; }
    var result = col;
    let aspect = 16.0 / 9.0; // correct circular distortion for widescreen

    for (var i: i32 = 0; i < 8; i = i + 1) {
        let fi = f32(i);
        // Stable unique seed per droplet
        let seed  = hash(vec2<f32>(fi * 17.3, fi * 5.7 + 3.1));
        let seed2 = hash(vec2<f32>(fi * 29.1, fi * 11.3));
        let seed3 = hash(vec2<f32>(fi * 43.7, fi * 7.9 + 1.5));

        // Horizontal position is fixed; vertical drifts downward slowly (gravity)
        let cx = seed * 0.8 + 0.1;
        let cy = fract(seed2 + t * (0.015 + seed3 * 0.01));
        let dropPos = vec2<f32>(cx, cy);
        let r = 0.03 + seed * 0.04; // radius: 3–7% of screen height

        // Aspect-corrected distance so droplets appear circular
        let dist = length((uv - dropPos) * vec2<f32>(aspect, 1.0));

        if (dist < r) {
            // Radial refraction: bend sample UVs outward from droplet centre
            // The (1 - dist/r) makes distortion strongest at the centre
            let refractDir = normalize((uv - dropPos) * vec2<f32>(aspect, 1.0));
            let refractStr = (1.0 - dist / r) * 0.03 * intensity;
            let lensUV = clamp(uv + refractDir * refractStr, vec2<f32>(0.001), vec2<f32>(0.999));

            // textureSampleLevel with explicit LOD avoids derivative issues in loops
            let refracted = textureSampleLevel(sceneTex, linearSampler, lensUV, 0.0).rgb;

            // Smooth interior blend
            let interior = smoothstep(r, r * 0.5, dist);
            result = mix(result, refracted, interior * 0.65);

            // Bright specular rim — light catches the droplet edge
            let rim = smoothstep(r, r * 0.88, dist) - smoothstep(r * 0.88, r * 0.70, dist);
            result = result + vec3<f32>(0.9, 0.95, 1.0) * rim * 0.35 * intensity;
        }
    }
    return result;
}

// ============================================================================
// CINEMATIC CAMERA FX (depth of field + speed blur)
// ============================================================================
// Both are off unless the CPU gate in src/renderer/cinematicCameraFx.ts opens
// them (quality >= high, prefers-reduced-motion off), so the default fragment
// path costs exactly one early-out branch.
//
// DOF focuses the mid-ground and defocuses the far field using the same depth
// proxy the fog uses — no depth buffer needed. Motion blur streaks radially
// away from the screen centre, which reads as forward travel, and its strength
// is already speed-scaled on the CPU.

const DOF_FOCUS_DEPTH: f32 = 0.45;

fn applyCameraFX(col: vec3<f32>, uv: vec2<f32>, dof: f32, mblur: f32) -> vec3<f32> {
    if (dof < 0.001 && mblur < 0.001) { return col; }

    let horizonY = viewHorizonY(p.cameraPitch);
    let depth = viewDepthProxy(uv, horizonY);

    // Circle of confusion: sharp at the focus plane, widening toward infinity.
    let coc = smoothstep(DOF_FOCUS_DEPTH, 1.0, depth) * dof;
    // Radial offset direction for the speed streak.
    let toCenter = uv - vec2<f32>(0.5, 0.5);

    var accum = col;
    var weight = 1.0;
    for (var i: i32 = 0; i < 6; i = i + 1) {
        let fi = f32(i);
        let angle = fi * 1.0471975 + 0.3;
        let ring = vec2<f32>(cos(angle), sin(angle)) * coc * 0.012;
        let streak = -toCenter * mblur * 0.09 * ((fi + 1.0) / 6.0);
        let tapUV = clamp(uv + ring + streak, vec2<f32>(0.001), vec2<f32>(0.999));
        accum = accum + textureSampleLevel(sceneTex, linearSampler, tapUV, 0.0).rgb;
        weight = weight + 1.0;
    }
    let blurred = accum / weight;

    // Blend by whichever effect is asking for more softening at this pixel.
    let edgeBias = smoothstep(0.05, 0.55, length(toCenter));
    let blend = clamp(max(coc, mblur * edgeBias), 0.0, 0.85);
    return mix(col, blurred, blend);
}

// ============================================================================
// HDR TONEMAPPING
// ============================================================================

// ACES (Academy Color Encoding System) Filmic Tonemapping
// Smoothly compresses high dynamic range values to displayable range
// Prevents harsh clipping of bright highlights (sun flares, headlights, etc.)
fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Alternative: Reinhard tonemapping (simpler, less contrasty)
fn reinhard_tonemap(color: vec3<f32>) -> vec3<f32> {
    return color / (1.0 + color);
}

// ============================================================================
// MAIN FRAGMENT SHADER
// ============================================================================

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(sceneTex));
    let uv = fragCoord.xy / texSize;
    
    // === SHADER BYPASS MODE ===
    // When shaderEffectsEnabled is 0, render raw Street View without effects
    if (p.shaderEffectsEnabled < 0.5) {
        return vec4<f32>(textureSample(sceneTex, linearSampler, uv).rgb, 1.0);
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
    col = applyNight(col, p.nightIntensity, uv, t);

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

    // === ATMOSPHERIC EFFECTS ===
    // Fog coverage is computed once and reused: it tints the scene *and*
    // attenuates everything suspended in it (dust, rain, snow).
    let fogMask = fogAmountAt(uv, p.fogIntensity, p.fogDensity, p.fogHeight, t);
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
    if (p.rainIntensity > 0.001) {
        let r = rain(uv, t, panX, panY) * p.rainIntensity * precipVisibility;
        let rainTint = mix(vec3<f32>(0.78, 0.88, 1.15), vec3<f32>(0.60, 0.70, 1.02), p.nightIntensity);
        col = col + r * rainTint * (1.0 + p.headlightsOn * p.nightIntensity * 0.5);
        col = col * (1.0 - p.rainIntensity * mix(0.22, 0.10, p.nightIntensity));
    }

    if (p.snowIntensity > 0.001) {
        let s = snow(uv, t, panX, panY) * p.snowIntensity * precipVisibility;
        let snowLit = 1.0 + p.headlightsOn * p.nightIntensity * 0.35;
        col = col + s * vec3<f32>(1.15, 1.18, 1.22) * snowLit;
    }

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

    return vec4<f32>(col, 1.0);
}
