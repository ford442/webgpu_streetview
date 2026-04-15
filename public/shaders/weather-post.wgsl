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
    _pad0             : f32,  // padding to maintain alignment
    // 36: sunrise
    sunrise           : f32,  // 0.0 = no sunrise, 1.0 = full sunrise
    // 37-39: padding to reach 40 floats (160 bytes total)
    _pad1             : f32,
    _pad2             : f32,
    _pad3             : f32,
}

@group(0) @binding(0) var<uniform> p: WeatherParams;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

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

        let streak = smoothstep(0.96, 1.0, 1.0 - length(st * vec2<f32>(0.45, 3.2)));
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

        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(st));
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

fn applyFog(col: vec3<f32>, uv: vec2<f32>, intensity: f32, density: f32, height: f32, colorIdx: f32, night: f32) -> vec3<f32> {
    if (intensity < 0.001 && density < 0.001) { return col; }
    
    let horizonDist = abs(uv.y - 0.5);
    let groundProximity = smoothstep(0.35, 0.0, horizonDist);
    
    var fogAmount = density * groundProximity;
    fogAmount = fogAmount + intensity * (0.2 + groundProximity * 0.8);
    
    let noise = noise2D(uv * 8.0 + p.time * 0.1) * 0.1;
    fogAmount = fogAmount * (0.9 + noise);
    
    // Day fog: #b5c1c8, Night fog: dark blue
    let dayFog = vec3<f32>(0.71, 0.76, 0.78);
    let nightFog = vec3<f32>(0.08, 0.12, 0.22);
    var fogColor = mix(dayFog, nightFog, clamp(night, 0.0, 1.0));
    
    // Override with indexed fog color if non-zero index
    let indexedColor = getFogColor(colorIdx);
    if (colorIdx > 0.5) { fogColor = indexedColor; }
    
    return mix(col, fogColor, clamp(fogAmount, 0.0, 0.95));
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
    
    let rayFalloff = exp(-distFromSun * 3.0) * (1.0 - distFromSun * 0.5);
    
    let dustUV = uv * 30.0 + vec2<f32>(t * 0.2, t * 0.1);
    let dust = noise2D(dustUV) * noise2D(dustUV * 2.0 + 10.0);
    let dustParticle = pow(dust, 2.0) * 2.0;
    
    let shaftIntensity = intensity * sunAbove * lookingAtSun * rayFalloff * (0.6 + rayMod * 0.4);
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
            
            let particle = smoothstep(0.15, 0.0, dist) * (0.5 + rnd * 0.5);
            
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

// === REALISTIC DARK NIGHT ===
// Simulates true night vision - very dark with only minimal ambient light
fn applyNight(col: vec3<f32>, night: f32, uv: vec2<f32>, t: f32) -> vec3<f32> {
    if (night < 0.001) { return col; }
    var c = col;
    
    // Much darker base - real night is ~0.5-1% of daylight (was 25%)
    let darkeningCurve = night * night * (3.0 - 2.0 * night); // Smoothstep curve
    c = c * mix(1.0, 0.03, darkeningCurve);
    
    // Enhanced desaturation for moonlight appearance
    let gray = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3<f32>(gray), night * 0.7);
    
    // Cool blue moonlight tint
    let moonTint = vec3<f32>(0.08, 0.12, 0.28);
    c = c + moonTint * night * 0.08;
    
    // Aggressive sky darkening - upper hemisphere goes nearly black
    let skyDarken = smoothstep(0.55, 0.05, uv.y);
    c = c * mix(1.0, 0.02, skyDarken * night);
    
    // Preserve only bright lights (streetlights, windows)
    let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lightMask = smoothstep(0.35, 0.9, lum);
    // Bloom around bright lights at night
    c = c + col * lightMask * night * 0.5;
    
    // Add stars - more visible with darker sky
    let starBrightness = night * 2.0; // Stars brighter against dark sky
    c = c + nightSky(uv, t) * starBrightness;
    
    // Subtle vignette for night vision effect
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.3, 1.0));
    let nightVignette = 1.0 - smoothstep(0.3, 1.0, centerDist) * night * 0.4;
    c = c * nightVignette;
    
    // Slight blue noise for night vision grain
    let noise = hash(uv * 500.0 + t * 0.1);
    c = c + (noise - 0.5) * 0.01 * night;
    
    return max(c, vec3<f32>(0.001)); // Prevent pure black
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

fn applySunrise(col: vec3<f32>, uv: vec2<f32>, sunrise: f32) -> vec3<f32> {
    if (sunrise < 0.001) { return col; }
    
    let horizonGlow = smoothstep(0.5, 0.0, uv.y);
    let warmHighlight = vec3<f32>(1.0, 0.65, 0.35) * horizonGlow * sunrise * 0.4;
    
    let shadowTint = mix(vec3<f32>(0.72, 0.58, 0.85), vec3<f32>(0.35, 0.45, 0.82), uv.y);
    let shadowMask = (1.0 - horizonGlow) * sunrise * 0.18;
    
    var result = col + warmHighlight;
    result = result + shadowTint * shadowMask;
    
    // Pink/gold color grading boost
    let goldBoost = vec3<f32>(0.15, 0.05, -0.05) * horizonGlow * sunrise;
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
    
    // === HEAT SHIMMER ===
    col = applyHeatShimmer(col, uv, p.heatShimmerIntensity, t);
    
    // === COLOR GRADING ===
    col = applyVibrance(col, p.vibrance);
    col = applySaturation(col, p.saturation);
    col = applyContrast(col, p.contrast);
    col = applyTemperatureTint(col, p.temperature, p.tint);
    col = applyExposure(col, p.exposure);

    // === NIGHTTIME MODE ===
    col = applyNight(col, p.nightIntensity, uv, t);

    // === HEADLIGHTS ===
    if (p.headlightsOn > 0.5) {
        let hlCone = headlightCone(uv, p.headlightHeading, p.headlightPitch, p.highBeam);
        let nightMul = mix(0.4, 1.0, p.nightIntensity);
        col = col + hlCone * nightMul * 0.6;
        col = col * (1.0 + hlCone * nightMul * 0.3);

        let beams = headlightBeams(uv, p.headlightHeading, p.headlightPitch, p.highBeam, t);
        col = col + vec3<f32>(1.0, 0.95, 0.82) * beams * nightMul;

        var fdx = uv.x - p.headlightHeading;
        if (fdx > 0.5) { fdx = fdx - 1.0; }
        if (fdx < -0.5) { fdx = fdx + 1.0; }
        let fdy = uv.y - p.headlightPitch;
        let flareDist = length(vec2<f32>(fdx, fdy));
        let flare = exp(-flareDist * flareDist * 120.0) * 0.15 * nightMul;
        col = col + vec3<f32>(1.0, 0.97, 0.88) * flare;
    }

    // === INTERIOR CABIN LIGHTING ===
    col = col + headlightInteriorBounce(uv, p.headlightsOn, p.nightIntensity);
    col = col + domeLightCabinGlow(uv, p.domeLightOn, p.domeLightIntensity);

    // === ASTRONOMICAL LIGHTING ===
    col = col + sunsetHorizonGlow(uv, p.sunAzimuth, p.sunAltitude, p.nightIntensity);
    col = applySunrise(col, uv, p.sunrise);
    col = directionalMoonlight(col, uv, p.moonAzimuth, p.moonAltitude, p.nightIntensity);

    // === ATMOSPHERIC EFFECTS ===
    col = applyFog(col, uv, p.fogIntensity, p.fogDensity, p.fogHeight, p.fogColorIndex, p.nightIntensity);
    col = applyVolumetricLightShafts(col, uv, p.lightShaftsIntensity, t);
    col = applyHumidityHaze(col, uv, p.humidityHaze, t);
    col = applyDustParticles(col, uv, p.dustIntensity, t);
    col = applyLensFlare(col, uv, p.lensFlareIntensity);
    col = applyVignette(col, uv);

    // === WEATHER EFFECTS (RAIN/SNOW with world-space camera offset) ===
    if (p.rainIntensity > 0.001) {
        let r = rain(uv, t, panX, panY) * p.rainIntensity;
        col = col + r * vec3<f32>(0.78, 0.88, 1.15);
        col = col * (1.0 - p.rainIntensity * 0.22);
    }
    
    if (p.snowIntensity > 0.001) {
        let s = snow(uv, t, panX, panY) * p.snowIntensity;
        col = col + s * vec3<f32>(1.15, 1.18, 1.22);
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
