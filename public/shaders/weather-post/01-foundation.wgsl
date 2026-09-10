// Weather Post-Process Shader
// Dual-pass HDR weather effects: rain streaks + snow flakes + nighttime + headlights
// 100% procedural, no textures, runs in rgba16float HDR
// NEW: Atmospheric effects - fog, light shafts, heat shimmer, lens effects, dust, humidity
//
// SOURCE FRAGMENT (1 of 3, see also 02-weather-fx.wgsl, 03-night-and-composite.wgsl):
// this file is concatenated with its siblings by scripts/gen-weather-post-shader.mjs
// into public/shaders/weather-post.wgsl, which is the file the renderer actually
// fetches at runtime and every WGSL test reads. Edit the fragments here, then run
// `npm run gen:weather-shader` — do not hand-edit the generated file.
//
// This fragment: uniform layout, bind group declarations, the full-screen vertex
// shader, camera-aware coordinate helpers, the depth proxy, noise/utility
// functions, and color grading.

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

