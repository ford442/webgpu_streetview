import package::lib::noise::{fbm, hash, noise2D};
import package::lib::sceneDepth::sceneDepth;
import package::weather::bindings::{p_cameraHeading, p_sunAltitude, p_sunAzimuth, p_wasmNoiseEnabled, p_wind, readDepthTexture, sampleScene, sceneTex, wasmNoiseAt};
import package::weather::depth::fogHeightFalloff;
import package::weather::horizon::{normalizedDistance, sceneHorizonY, worldAzimuthToScreenX};

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
//
// The compute pass also has last frame's view depth (binding 4): it eases the
// extinction depth toward it at `coord`, which steadies the bank under motion.
fn fogAmountAt(uv: vec2<f32>, intensity: f32, density: f32, height: f32, t: f32, @if(compute) coord: vec2<i32>) -> f32 {
    if (intensity < 0.001 && density < 0.001) { return 0.0; }

    let horizonY = sceneHorizonY();
    @if(compute) let viewDepth = sceneDepth(uv, horizonY);
    @if(compute) let prevDepth = textureLoad(readDepthTexture, coord, 0).r;
    @if(compute) let depth = select(viewDepth, mix(viewDepth, prevDepth, 0.35), prevDepth > 0.001);
    @else let depth = sceneDepth(uv, horizonY);
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

    // Near-horizon enhancement: second harmonic intensifies crepuscular rays at low sun angles
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
    let shimmerCol = sampleScene(shimmerUV).rgb;
    
    let groundProximity = smoothstep(0.8, 0.2, uv.y);
    let blend = intensity * groundProximity * 0.3;
    
    return mix(col, shimmerCol, blend);
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
    let v00 = wasmNoiseAt(y0 * 64 + x0);
    let v10 = wasmNoiseAt(y0 * 64 + x1);
    let v01 = wasmNoiseAt(y1 * 64 + x0);
    let v11 = wasmNoiseAt(y1 * 64 + x1);
    return mix(mix(v00, v10, fx), mix(v01, v11, fx), fy);
}

// === 5. DUST/POLLEN PARTICLES (Camera-Aware) ===
fn applyDustParticles(col: vec3<f32>, uv: vec2<f32>, intensity: f32, t: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }

    var dustAccum = vec3<f32>(0.0);

    // Pre-calculate sun screen position for sparkle effect
    let sunScreenX = worldAzimuthToScreenX(p_sunAzimuth(), p_cameraHeading());
    let dSunX = normalizedDistance(uv.x, sunScreenX);
    let sunUvY = 1.0 - clamp(p_sunAltitude() / 1.5708, 0.0, 1.0);
    let sunDist = length(vec2<f32>(dSunX * 2.0, uv.y - sunUvY));
    let sunVisible = smoothstep(0.0, 0.1, p_sunAltitude());
    let towardSun = smoothstep(0.5, 0.0, sunDist);

    // WASM-driven cloud density: slow drifting turbulence sampled from the
    // CPU-computed noise tile, so dust motes clump into organic patches
    // instead of being uniformly distributed. Disable with ?wasmNoise=off
    // to compare against the plain per-pixel randomness below.
    var cloudDensity = 1.0;
    if (p_wasmNoiseEnabled() > 0.5) {
        let cloudUV = uv * 1.5 + vec2<f32>(t * 0.015, t * 0.008);
        cloudDensity = 0.35 + 0.65 * (0.5 + 0.5 * sampleWasmNoiseTile(cloudUV));
    }

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
    
    let n1 = sampleScene(uv + vec2<f32>(softening, 0.0)).rgb;
    let n2 = sampleScene(uv - vec2<f32>(softening, 0.0)).rgb;
    let n3 = sampleScene(uv + vec2<f32>(0.0, softening)).rgb;
    let n4 = sampleScene(uv - vec2<f32>(0.0, softening)).rgb;
    
    let blurred = (n1 + n2 + n3 + n4) * 0.25;
    result = mix(result, blurred, intensity * distanceFactor * 0.15);
    
    return result;
}
