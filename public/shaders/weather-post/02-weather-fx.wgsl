// SOURCE FRAGMENT (2 of 3, see also 01-foundation.wgsl, 03-night-and-composite.wgsl):
// concatenated by scripts/gen-weather-post-shader.mjs into
// public/shaders/weather-post.wgsl — do not hand-edit the generated file.
//
// This fragment: rain/snow and the atmospheric effects (fog, volumetric light
// shafts, heat shimmer, lens flare, chromatic aberration, vignette, dust,
// humidity haze).

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

