// SOURCE FRAGMENT (3 of 3, see also 01-foundation.wgsl, 02-weather-fx.wgsl):
// concatenated by scripts/gen-weather-post-shader.mjs into
// public/shaders/weather-post.wgsl — do not hand-edit the generated file.
//
// This fragment: nighttime/starfield, headlights, cabin lighting, astronomical
// (sunset/sunrise/moonlight) effects, refractive lens droplets, cinematic
// camera FX, HDR tonemapping, and the fs_main entry point.

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
