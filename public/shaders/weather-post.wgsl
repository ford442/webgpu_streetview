// Weather Post-Process Shader
// Dual-pass HDR weather effects: rain streaks + snow flakes + nighttime + headlights
// 100% procedural, no textures, runs in rgba16float HDR

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
    // 22-23: padding
    _pad0             : f32,
    _pad1             : f32,
}

@group(0) @binding(0) var<uniform> p: WeatherParams;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

// Vertex shader - full screen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    // Generate a full-screen triangle
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

// Hash function for pseudo-random numbers
fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Color grading functions
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

// Kelvin to RGB conversion using blackbody radiation formula
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
    // temperature: -1.0 to 1.0 mapped to ~3000K-10000K, 0 = 6500K neutral
    // tint: -1.0 to 1.0 (magenta-green axis)
    let kelvin = 6500.0 + temperature * 5000.0;
    let kelvinRGB = kelvinToRGB(kelvin);
    let neutralRGB = kelvinToRGB(6500.0);
    var tempMult = kelvinRGB / neutralRGB;
    
    // Apply tint (magenta-green axis)
    tempMult.g = tempMult.g * (1.0 + tint * 0.1);
    tempMult.r = tempMult.r * (1.0 + tint * 0.05);
    tempMult.b = tempMult.b * (1.0 + tint * 0.05);
    
    return col * tempMult;
}

// Rain streaks (4 tilted layers, very cheap)
fn rain(uv: vec2<f32>, t: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let layer = f32(i);
        var st = uv * vec2<f32>(1.0, 3.0 + layer * 1.5);
        st.x = st.x + p.wind * (0.3 + layer * 0.2);
        st.y = st.y + t * (3.5 + layer * 2.2) * (0.8 + p.rainIntensity * 0.4);

        let seed = hash(vec2<f32>(floor(st.x * 42.0 + layer * 11.0), floor(st.y)));
        st.x = fract(st.x * 42.0) - 0.5 + (seed - 0.5) * 0.8;
        st.y = fract(st.y);

        let streak = smoothstep(0.96, 1.0, 1.0 - length(st * vec2<f32>(0.45, 3.2)));
        c = c + streak * (0.7 + seed * 0.8);
    }
    return c * 0.75;
}

// Snow flakes (5 drifting layers with gentle sway)
fn snow(uv: vec2<f32>, t: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        var st = uv * (4.0 + layer * 3.2);
        st.x = st.x + p.wind * (0.5 + layer * 0.25);
        st.y = st.y + t * (0.6 + layer * 0.35);  // gentle fall
        st.x = st.x + sin(t * 1.8 + layer * 3.0 + st.y * 2.0) * 0.15;  // sway

        let id = floor(st);
        let rnd = hash(id + vec2<f32>(layer));
        st = fract(st) - vec2<f32>(0.5);

        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(st));
        c = c + flake * (0.85 + rnd * 0.6);
    }
    return c * 1.35;
}

// === Nighttime: procedural star field (cheap Voronoi) ===
fn starField(uv: vec2<f32>, scale: f32, t: f32) -> f32 {
    let suv = uv * scale;
    let cell = floor(suv);
    let fuv = fract(suv) - vec2<f32>(0.5);
    // Per-cell random point
    let rnd = hash(cell * vec2<f32>(127.1, 311.7) + vec2<f32>(74.7, 29.3));
    let rnd2 = hash(cell * vec2<f32>(269.5, 183.3));
    if (rnd > 0.35) { return 0.0; } // sparse stars
    let offset = vec2<f32>(rnd, rnd2) - vec2<f32>(0.5);
    let dist = length(fuv - offset * 0.8);
    let starSize = 0.015 + rnd2 * 0.025;
    let star = smoothstep(starSize, starSize * 0.1, dist);
    // Twinkle
    let phase = rnd * 6.2832;
    let twinkle = 0.5 + 0.5 * sin(t * (1.5 + rnd2 * 2.5) + phase);
    return star * twinkle;
}

fn nightSky(uv: vec2<f32>, t: f32) -> vec3<f32> {
    // Stars only in upper hemisphere (uv.y < 0.4 = top of panorama)
    let skyMask = smoothstep(0.45, 0.15, uv.y);
    if (skyMask < 0.001) { return vec3<f32>(0.0); }
    var stars = starField(uv, 25.0, t) * 1.0;
    stars = stars + starField(uv + vec2<f32>(13.7, 7.3), 40.0, t) * 0.6;
    stars = stars + starField(uv + vec2<f32>(31.1, 53.7), 60.0, t) * 0.3;
    let starColor = vec3<f32>(0.95, 0.95, 1.0);
    return stars * starColor * skyMask;
}

// === Nighttime color transform ===
fn applyNight(col: vec3<f32>, night: f32, uv: vec2<f32>, t: f32) -> vec3<f32> {
    if (night < 0.001) { return col; }
    var c = col;
    // Crush blacks and lower exposure
    c = c * mix(1.0, 0.25, night);
    // Reduce saturation at night
    let gray = dot(c, vec3<f32>(0.299, 0.587, 0.114));
    c = mix(c, vec3<f32>(gray), night * 0.55);
    // Cool moonlight tint (deep blue/teal)
    let moonTint = vec3<f32>(0.12, 0.18, 0.32);
    c = c + moonTint * night * 0.15;
    // Darken upper hemisphere (sky) more aggressively
    let skyDarken = smoothstep(0.5, 0.1, uv.y);
    c = c * mix(1.0, 0.15, skyDarken * night);
    // Subtle city-light bloom on bright spots
    let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let bloomMask = smoothstep(0.45, 0.85, lum);
    c = c + col * bloomMask * night * 0.35;
    // Add procedural stars
    c = c + nightSky(uv, t) * night * 1.2;
    return c;
}

// === Headlight cone effect ===
fn headlightCone(uv: vec2<f32>, hlHeading: f32, hlPitch: f32, highBeam: f32) -> vec3<f32> {
    // Convert UV to angular offset from headlight direction
    // headlight points at (hlHeading, hlPitch) in normalized UV space
    var dx = uv.x - hlHeading;
    // Wrap horizontally for panoramic
    if (dx > 0.5) { dx = dx - 1.0; }
    if (dx < -0.5) { dx = dx + 1.0; }
    let dy = uv.y - hlPitch;

    // Cone shape: narrow yaw, wider downward, focused in lower hemisphere
    let yawWidth = mix(0.08, 0.14, highBeam);   // horizontal spread
    let pitchWidth = mix(0.12, 0.20, highBeam);  // vertical spread
    let angX = dx / yawWidth;
    let angY = dy / pitchWidth;

    // Elliptical falloff
    let dist = angX * angX + angY * angY;
    let cone = exp(-dist * 2.5);

    // Bias cone downward (headlights illuminate the road below)
    let downBias = smoothstep(-0.15, 0.15, dy);
    let coneFinal = cone * mix(1.0, 0.3, downBias);

    // Warm headlight color (yellowish white)
    let warmColor = vec3<f32>(1.0, 0.92, 0.75);
    // Hotter center
    let centerIntensity = exp(-dist * 8.0);
    let hotSpot = vec3<f32>(1.0, 0.98, 0.9) * centerIntensity * 0.5;

    let strength = mix(0.7, 1.2, highBeam);
    return (warmColor * coneFinal * strength + hotSpot);
}

// === Volumetric headlight beams (cheap fake god-rays) ===
fn headlightBeams(uv: vec2<f32>, hlHeading: f32, hlPitch: f32, highBeam: f32, t: f32) -> f32 {
    var dx = uv.x - hlHeading;
    if (dx > 0.5) { dx = dx - 1.0; }
    if (dx < -0.5) { dx = dx + 1.0; }
    let dy = uv.y - hlPitch;

    let beamWidth = mix(0.06, 0.10, highBeam);
    let angX = dx / beamWidth;
    // Elongate vertically (beams project downward)
    let angY = dy / 0.25;

    let dist = angX * angX + angY * angY * 0.3;
    let beam = exp(-dist * 3.0);

    // Add subtle noise for volumetric feel
    let noiseUV = uv * vec2<f32>(50.0, 30.0) + vec2<f32>(t * 0.3, t * 0.1);
    let n = hash(floor(noiseUV)) * 0.3 + 0.7;

    return beam * n * mix(0.12, 0.25, highBeam);
}

// Warm amber dashboard glow rising from bottom frame (headlight bounce inside cabin)
fn headlightInteriorBounce(uv: vec2<f32>, hlOn: f32, night: f32) -> vec3<f32> {
    if (hlOn < 0.5 || night < 0.01) { return vec3<f32>(0.0); }
    let bottomGrad = smoothstep(0.30, 0.0, uv.y);
    return vec3<f32>(1.0, 0.58, 0.18) * bottomGrad * night * 0.12;
}

// Soft warm oval at top frame (dome light cast on windshield/headliner)
fn domeLightCabinGlow(uv: vec2<f32>, domeOn: f32, domeIntensity: f32) -> vec3<f32> {
    if (domeOn < 0.5 || domeIntensity < 0.01) { return vec3<f32>(0.0); }
    let topGrad = smoothstep(0.25, 0.0, 1.0 - uv.y);
    let cx = uv.x - 0.5;
    let hFade = exp(-cx * cx * 8.0);
    return vec3<f32>(1.0, 0.91, 0.71) * topGrad * hFade * domeIntensity * 0.06;
}

const GOLDEN_HOUR_RANGE: f32 = 0.105;  // ±6° in radians

// Golden hour / sunset horizon glow with directional sun bias.
// SunCalc azimuth convention: 0=S, π/2=W, π=N, -π/2=E.
fn sunsetHorizonGlow(uv: vec2<f32>, sunAz: f32, sunAlt: f32, night: f32) -> vec3<f32> {
    // Active only when sun is near horizon (−6° to +6°)
    let altFactor = 1.0 - clamp(abs(sunAlt) / GOLDEN_HOUR_RANGE, 0.0, 1.0);
    let nightFade = 1.0 - clamp(night / 0.85, 0.0, 1.0);
    let strength  = altFactor * nightFade;
    if (strength < 0.002) { return vec3<f32>(0.0); }

    // Normalize azimuth to UV.x (0=N, 0.25=E, 0.5=S, 0.75=W)
    let sunNormX = fract((sunAz + 3.14159265) / (2.0 * 3.14159265));
    var dSunX = uv.x - sunNormX;
    if (dSunX >  0.5) { dSunX -= 1.0; }
    if (dSunX < -0.5) { dSunX += 1.0; }
    // Broad horizontal spread (±one-third of panorama)
    let hFade = smoothstep(0.33, 0.0, abs(dSunX));

    // Warm vertical band around horizon (lower frame)
    let vertGrad = smoothstep(0.80, 0.30, uv.y);

    // Golden to reddish gradient by height
    let goldenColor  = vec3<f32>(1.0, 0.72, 0.35);   // Scientific: 3500K
    let reddishColor = vec3<f32>(0.95, 0.35, 0.12);  // Scientific: 2000K
    let sunsetColor  = mix(goldenColor, reddishColor, smoothstep(0.40, 0.60, uv.y));

    let glow = sunsetColor * vertGrad * hFade * strength;
    // Multiplicative warmth + subtle additive bloom
    return glow * (1.0 + glow * 0.5) + glow * 0.2;
}

// Directional moonlight — cool silvery tint + specular highlight in moon direction.
fn directionalMoonlight(col: vec3<f32>, uv: vec2<f32>, moonAz: f32, moonAlt: f32, night: f32) -> vec3<f32> {
    // Only visible when moon is above horizon and sky is dark enough
    let moonAbove = clamp(moonAlt / 0.8, 0.0, 1.0);
    let strength  = moonAbove * clamp((night - 0.4) / 0.6, 0.0, 1.0);
    if (strength < 0.002) { return col; }

    let moonColor = vec3<f32>(0.72, 0.82, 1.0);  // silvery cool blue-white

    // Moon's approximate UV position (same azimuth convention as sun)
    let moonNormX = fract((moonAz + 3.14159265) / (2.0 * 3.14159265));
    var dMoonX = uv.x - moonNormX;
    if (dMoonX >  0.5) { dMoonX -= 1.0; }
    if (dMoonX < -0.5) { dMoonX += 1.0; }
    let moonUvY = 1.0 - clamp(moonAlt / 1.5708, 0.0, 1.0);

    // Tight specular highlight at moon's position
    let moonDist = length(vec2<f32>(dMoonX * 2.5, uv.y - moonUvY));
    let specular  = exp(-moonDist * moonDist * 35.0) * 0.15 * strength;

    // Broad ambient cool tint on upper sky
    let skyGrad = smoothstep(0.55, 0.15, uv.y);
    let ambient = moonColor * skyGrad * strength * 0.04;

    // Luminance-weighted cool highlight on existing bright surfaces
    let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let lumTint = moonColor * smoothstep(0.3, 0.85, lum) * strength * 0.06;

    return col + ambient + moonColor * specular + lumTint;
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(sceneTex));
    let uv = fragCoord.xy / texSize;
    var col = textureSample(sceneTex, linearSampler, uv).rgb;

    // === Color grading ===
    col = applyVibrance(col, p.vibrance);
    col = applySaturation(col, p.saturation);
    col = applyContrast(col, p.contrast);
    col = applyTemperatureTint(col, p.temperature, p.tint);
    col = applyExposure(col, p.exposure);

    // === Time & environmental effects ===
    let t = p.time * p.speed;

    // === Nighttime mode ===
    col = applyNight(col, p.nightIntensity, uv, t);

    // === Headlights ===
    if (p.headlightsOn > 0.5) {
        // Primary cone lighting on panorama
        let hlCone = headlightCone(uv, p.headlightHeading, p.headlightPitch, p.highBeam);
        // Multiply + additive blend for realism
        let nightMul = mix(0.4, 1.0, p.nightIntensity); // stronger at night
        col = col + hlCone * nightMul * 0.6;
        col = col * (1.0 + hlCone * nightMul * 0.3);

        // Volumetric beams (subtle)
        let beams = headlightBeams(uv, p.headlightHeading, p.headlightPitch, p.highBeam, t);
        col = col + vec3<f32>(1.0, 0.95, 0.82) * beams * nightMul;

        // Subtle lens flare near headlight center
        var fdx = uv.x - p.headlightHeading;
        if (fdx > 0.5) { fdx = fdx - 1.0; }
        if (fdx < -0.5) { fdx = fdx + 1.0; }
        let fdy = uv.y - p.headlightPitch;
        let flareDist = length(vec2<f32>(fdx, fdy));
        let flare = exp(-flareDist * flareDist * 120.0) * 0.15 * nightMul;
        col = col + vec3<f32>(1.0, 0.97, 0.88) * flare;
    }

    // === Interior cabin lighting ===
    col = col + headlightInteriorBounce(uv, p.headlightsOn, p.nightIntensity);
    col = col + domeLightCabinGlow(uv, p.domeLightOn, p.domeLightIntensity);

    // === Astronomical lighting ===
    col = col + sunsetHorizonGlow(uv, p.sunAzimuth, p.sunAltitude, p.nightIntensity);
    col = directionalMoonlight(col, uv, p.moonAzimuth, p.moonAltitude, p.nightIntensity);

    // === Weather effects ===
    if (p.rainIntensity > 0.001) {
        let r = rain(uv, t) * p.rainIntensity;
        col = col + r * vec3<f32>(0.78, 0.88, 1.15);  // cool blue-ish glow
        col = col * (1.0 - p.rainIntensity * 0.22);   // wet darkening
    }
    
    if (p.snowIntensity > 0.001) {
        let s = snow(uv, t) * p.snowIntensity;
        col = col + s * vec3<f32>(1.15, 1.18, 1.22);  // bright snowy glow
    }

    // Final cheap dither to prevent banding
    let noise = fract(sin(dot(fragCoord.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    col = col + (noise - 0.5) * 0.0025;

    return vec4<f32>(col, 1.0);
}
