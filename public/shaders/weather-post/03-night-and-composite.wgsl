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

    let horizonY = sceneHorizonY();
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

    let horizonY = sceneHorizonY();
    let depth = sceneDepth(uv, horizonY);

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
// SEMANTIC SCENE LAYER (#352) — class lookups and the effects that use them
// ============================================================================
// Every helper here takes its pre-semantic branch while semParams.blend is 0
// (no map, the layer off, Low/Medium quality): it returns its input exactly.

// Class-map UV for a screen UV (minus the look-around since inference) and
// how much of the map covers it, as (u, v, coverage). Coverage fades to 0
// where the shifted UV leaves the map, like sampleSceneDepthMap.
fn semanticMapUv(uv: vec2<f32>) -> vec3<f32> {
    let muv = uv - vec2<f32>(semParams.shiftX, semParams.shiftY);
    let edge = min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y));
    return vec3<f32>(clamp(muv, vec2<f32>(0.0), vec2<f32>(1.0)), smoothstep(0.0, 0.04, edge));
}

// Class id (-1 = unlabelled) and probability at one map texel (clamped to the map).
fn semanticTexel(texel: vec2<i32>) -> vec2<f32> {
    let dims = vec2<i32>(textureDimensions(semanticTex));
    let s = textureLoad(semanticTex, clamp(texel, vec2<i32>(0), dims - vec2<i32>(1)), 0);
    return vec2<f32>(round(s.r * 255.0) - 1.0, s.g);
}

// The class at a screen UV: (id, probability, coverage); id -1 = unlabelled.
fn sceneClass(uv: vec2<f32>) -> vec3<f32> {
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let c = semanticTexel(vec2<i32>(floor(m.xy * dims)));
    return vec3<f32>(c.x, c.y, m.z);
}

// Weight of one class at a screen UV, 0-1: the class indicator interpolated
// between the four nearest map texels (a one-texel feather, ~5 px at 1080p —
// class ids themselves are never filtered), times map coverage and
// semParams.blend. 0 without a map.
fn classWeight(uv: vec2<f32>, cls: i32) -> f32 {
    if (semParams.blend <= 0.0) { return 0.0; }
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let pos = m.xy * dims - vec2<f32>(0.5);
    let base = floor(pos);
    let f = pos - base;
    let b = vec2<i32>(base);
    let c = f32(cls);
    let i00 = select(0.0, 1.0, semanticTexel(b).x == c);
    let i10 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(1, 0)).x == c);
    let i01 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(0, 1)).x == c);
    let i11 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(1, 1)).x == c);
    let w = mix(mix(i00, i10, f.x), mix(i01, i11, f.x), f.y);
    return w * m.z * clamp(semParams.blend, 0.0, 1.0);
}

// The photo's own sky colour keyed against one of its pixels: ~1 where the
// photograph shows that sky (semParams.skyR/G/B, the mean of the pixels the map
// labelled sky), fading out a little below the horizon (a pitched-up camera
// sees sky below the pitch horizon). For the sky the network cannot see —
// through bare branches it labels vegetation. 0 without a map or without sky.
fn semanticSkyKey(uv: vec2<f32>, photo: vec3<f32>) -> f32 {
    if (semParams.blend <= 0.0 || semParams.skyR + semParams.skyG + semParams.skyB <= 0.0) { return 0.0; }
    let horizonY = sceneHorizonY();
    let d = photo - vec3<f32>(semParams.skyR, semParams.skyG, semParams.skyB);
    // Saturating: a sky pixel between twigs is fully sky; the twigs fall to 0.
    return smoothstep(0.2, 0.65, exp(-dot(d, d) * 20.0)) * smoothstep(horizonY + 0.25, horizonY + 0.1, uv.y);
}

// Rain over the sky: streak energy thinned where the map says sky, so rain
// reads as falling in front of the street rather than painted on the clouds.
fn semanticRain(streaks: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (semParams.blend <= 0.0) { return streaks; }
    return streaks * (1.0 - clamp(semParams.rainSky, 0.0, 1.0) * classWeight(uv, CLASS_SKY));
}

// Fog at the skyline: the bank lies below it, so over sky pixels its coverage
// relaxes instead of pooling as if the sky were the densest, farthest ground.
fn semanticFog(fogAmount: f32, uv: vec2<f32>) -> f32 {
    if (semParams.blend <= 0.0) { return fogAmount; }
    let sky = classWeight(uv, CLASS_SKY) * clamp(semParams.fogSky, 0.0, 1.0);
    return fogAmount * (1.0 - 0.55 * sky);
}

// Wet road: only road (and, weaker, sidewalk) pixels darken and pick up a
// rippled reflection of the frame mirrored about the horizon, stronger at a
// grazing distance (Fresnel) and dimmed at night. Zero on every other class.
fn semanticWetRoad(col: vec3<f32>, uv: vec2<f32>, rainAmount: f32, night: f32, t: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.wetRoad <= 0.0 || rainAmount <= 0.001) { return col; }
    let wet = classWeight(uv, CLASS_ROAD) + 0.6 * classWeight(uv, CLASS_SIDEWALK);
    if (wet <= 0.001) { return col; }
    let amount = clamp(wet, 0.0, 1.0) * clamp(semParams.wetRoad, 0.0, 1.0) * clamp(rainAmount, 0.0, 1.0);
    let horizonY = sceneHorizonY();
    let depth = clamp(sceneDepth(uv, horizonY), 0.0, 1.0);
    let ripple = (noise2D(uv * vec2<f32>(90.0, 220.0) + vec2<f32>(0.0, t * 1.7)) - 0.5) * 0.012;
    let mirrorY = 2.0 * horizonY - uv.y;
    let ruv = clamp(vec2<f32>(uv.x + ripple, mirrorY + ripple * 2.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let reflection = textureSampleLevel(sceneTex, linearSampler, ruv, 0.0).rgb;
    let inFrame = select(0.0, 1.0, mirrorY >= 0.0);
    let fresnel = mix(0.12, 0.55, depth) * mix(1.0, 0.15, clamp(night, 0.0, 1.0));
    return col * mix(1.0, 0.72, amount) + reflection * fresnel * amount * inFrame;
}

// Settled snow: road, sidewalk and (softer) vegetation whiten with the snow
// intensity — broken up near the camera, solid toward the horizon where the
// ground is seen at a grazing angle (the scene depth). Walls, vehicles,
// people and sky never collect it.
fn semanticSnowCover(col: vec3<f32>, uv: vec2<f32>, snowAmount: f32, night: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.snowCover <= 0.0 || snowAmount <= 0.001) { return col; }
    // Vegetation, but not the sky seen through its bare branches.
    let photo = textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb;
    let veg = classWeight(uv, CLASS_VEGETATION) * (1.0 - semanticSkyKey(uv, photo));
    let ground = classWeight(uv, CLASS_ROAD) + classWeight(uv, CLASS_SIDEWALK) + 0.45 * veg;
    if (ground <= 0.001) { return col; }
    let depth = clamp(sceneDepth(uv, sceneHorizonY()), 0.0, 1.0);
    let breakup = noise2D(uv * vec2<f32>(60.0, 140.0)) * 0.6 + noise2D(uv * vec2<f32>(240.0, 520.0)) * 0.4;
    let thickness = clamp(snowAmount * 0.8, 0.0, 1.0) * mix(0.55, 1.0, depth);
    let settle = smoothstep(1.0 - thickness, 1.0 - thickness * 0.4, breakup * 0.5 + thickness * 0.75);
    let cover = clamp(ground, 0.0, 1.0) * clamp(semParams.snowCover, 0.0, 1.0) * settle;
    let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let snowCol = vec3<f32>(0.92, 0.95, 1.0) * max(mix(0.85, 0.1, clamp(night, 0.0, 1.0)), lum * 1.3);
    return mix(col, snowCol, cover);
}

// Dusk-to-night relight, on top of applyNight: sky and vegetation sink
// further; building pixels darker than the wall around them (window recesses
// in a daytime photo) light up warm, a per-cell hash keeping ~40% lit with a
// slow flicker; road and sidewalk pick up sodium pools at depth-spaced lamp
// positions; vehicle pixels just above their lower edge get tail lights.
// People are never relit. `base` is the graded colour before applyNight.
fn semanticRelight(col: vec3<f32>, base: vec3<f32>, uv: vec2<f32>, night: f32, t: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.relight <= 0.0 || night <= 0.001) { return col; }
    let k = clamp(semParams.relight, 0.0, 1.0) * clamp(night, 0.0, 1.0);
    // Sky seen through bare branches (labelled vegetation) sinks like the sky.
    let vegAll = classWeight(uv, CLASS_VEGETATION);
    let throughBranches = vegAll * semanticSkyKey(uv, textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb);
    let sky = classWeight(uv, CLASS_SKY) + throughBranches;
    let veg = vegAll - throughBranches;
    let building = classWeight(uv, CLASS_BUILDING);
    let road = classWeight(uv, CLASS_ROAD) + 0.7 * classWeight(uv, CLASS_SIDEWALK);
    let vehicle = classWeight(uv, CLASS_VEHICLE);
    var c = col * (1.0 - k * (0.45 * sky + 0.35 * veg));

    if (building > 0.001) {
        let px = vec2<f32>(5.0) / vec2<f32>(textureDimensions(sceneTex));
        let w709 = vec3<f32>(0.2126, 0.7152, 0.0722);
        let center = dot(textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb, w709);
        let around = (dot(textureSampleLevel(sceneTex, linearSampler, uv + vec2<f32>(px.x, 0.0), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv - vec2<f32>(px.x, 0.0), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv + vec2<f32>(0.0, px.y), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv - vec2<f32>(0.0, px.y), 0.0).rgb, w709)) * 0.25;
        let recess = smoothstep(0.02, 0.12, around - center);
        let cell = floor(uv * vec2<f32>(64.0, 44.0));
        let lit = step(0.6, hash(cell + vec2<f32>(17.0, 3.0)));
        let phase = hash(cell + vec2<f32>(5.0, 41.0)) * 6.2832;
        let flicker = mix(0.88 + 0.12 * sin(t * 0.9 + phase), 1.0, clamp(semParams.stillness, 0.0, 1.0));
        c = c + vec3<f32>(1.0, 0.72, 0.42) * (building * recess * lit * flicker * k * 0.9);
    }

    if (road > 0.001) {
        let depth = clamp(sceneDepth(uv, sceneHorizonY()), 0.0, 1.0);
        let lampPhase = fract(depth * 7.0 + 0.35);
        let pool = exp(-pow((lampPhase - 0.5) * 4.5, 2.0)) * smoothstep(0.95, 0.55, depth);
        c = c + base * vec3<f32>(1.0, 0.66, 0.32) * (clamp(road, 0.0, 1.0) * pool * k * 1.3);
    }

    if (vehicle > 0.001) {
        // Tail and marker lights: a few soft red glows low on each vehicle (just
        // above where its mask ends), sparse along the row — not a lit stripe.
        let lower = classWeight(uv + vec2<f32>(0.0, 0.025), CLASS_VEHICLE);
        let below = classWeight(uv + vec2<f32>(0.0, 0.06), CLASS_VEHICLE);
        let band = vehicle * lower * (1.0 - below);
        let lamp = smoothstep(0.7, 0.92, noise2D(vec2<f32>(uv.x * 36.0, 7.0)));
        c = c + vec3<f32>(1.0, 0.1, 0.05) * (band * lamp * k * 0.6);
    }
    return c;
}

// Sky matte: the sky indicator upsampled from the class map by a joint
// bilateral filter — each of the four nearest map texels is weighted by how
// close the photo's colour at its centre is to this pixel's, so the matte
// follows rooflines and tree crowns instead of the map's texel grid — times
// the map's confidence. 0 without a map.
fn semanticSkyMatte(uv: vec2<f32>) -> f32 {
    if (semParams.blend <= 0.0) { return 0.0; }
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let pos = m.xy * dims - vec2<f32>(0.5);
    let base = floor(pos);
    let f = pos - base;
    let here = textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb;
    let shift = vec2<f32>(semParams.shiftX, semParams.shiftY);
    var num = 0.0;
    var den = 0.0;
    for (var j: i32 = 0; j < 4; j = j + 1) {
        let o = vec2<f32>(f32(j & 1), f32(j >> 1u));
        let tap = semanticTexel(vec2<i32>(base + o));
        let tapUv = (base + o + vec2<f32>(0.5)) / dims + shift;
        let tapCol = textureSampleLevel(sceneTex, linearSampler, clamp(tapUv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
        let d = here - tapCol;
        let spatial = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
        let w = spatial * exp(-dot(d, d) * 40.0) + 1e-4;
        num = num + w * select(0.0, smoothstep(0.35, 0.75, tap.y), tap.x == f32(CLASS_SKY));
        den = den + w;
    }
    // Plus the sky the network could not see: through bare branches it
    // labelled vegetation, keyed on the photo's own sky colour.
    let keyed = semanticSkyKey(uv, here) * classWeight(uv, CLASS_VEGETATION);
    return max((num / den) * m.z * clamp(semParams.blend, 0.0, 1.0), keyed);
}

// Perez's sky distribution for one channel of the Preetham model.
fn perezTerm(cosTheta: f32, gamma: f32, cosGamma: f32, a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
    return (1.0 + a * exp(b / max(cosTheta, 0.01))) * (1.0 + c * exp(d * gamma) + e * cosGamma * cosGamma);
}

// Preetham analytic daylight sky (1999), linear sRGB, for a view direction
// and a sun direction (y up). The sun is held just above the horizon — below
// it the caller blends to the night sky.
fn preethamSky(dir: vec3<f32>, sunDir: vec3<f32>, turbidity: f32) -> vec3<f32> {
    let tb = turbidity;
    let thetaS = acos(clamp(sunDir.y, 0.03, 1.0));
    let cosThetaS = cos(thetaS);
    let cosTheta = max(dir.y, 0.0);
    let cosGamma = clamp(dot(dir, normalize(vec3<f32>(sunDir.x, max(sunDir.y, 0.03), sunDir.z))), -1.0, 1.0);
    let gamma = acos(cosGamma);
    let chi = (4.0 / 9.0 - tb / 120.0) * (3.14159265 - 2.0 * thetaS);
    let yz = max((4.0453 * tb - 4.9710) * tan(chi) - 0.2155 * tb + 2.4192, 0.05);
    let s1 = thetaS;
    let s2 = s1 * s1;
    let s3 = s2 * s1;
    let xz = tb * tb * (0.00166 * s3 - 0.00375 * s2 + 0.00209 * s1)
        + tb * (-0.02903 * s3 + 0.06377 * s2 - 0.03202 * s1 + 0.00394)
        + (0.11693 * s3 - 0.21196 * s2 + 0.06052 * s1 + 0.25886);
    let yzc = tb * tb * (0.00275 * s3 - 0.00610 * s2 + 0.00317 * s1)
        + tb * (-0.04214 * s3 + 0.08970 * s2 - 0.04153 * s1 + 0.00516)
        + (0.15346 * s3 - 0.26756 * s2 + 0.06670 * s1 + 0.26688);
    let lum = yz
        * perezTerm(cosTheta, gamma, cosGamma, 0.1787 * tb - 1.4630, -0.3554 * tb + 0.4275, -0.0227 * tb + 5.3251, 0.1206 * tb - 2.5771, -0.0670 * tb + 0.3703)
        / perezTerm(1.0, thetaS, cosThetaS, 0.1787 * tb - 1.4630, -0.3554 * tb + 0.4275, -0.0227 * tb + 5.3251, 0.1206 * tb - 2.5771, -0.0670 * tb + 0.3703);
    let cx = xz
        * perezTerm(cosTheta, gamma, cosGamma, -0.0193 * tb - 0.2592, -0.0665 * tb + 0.0008, -0.0004 * tb + 0.2125, -0.0641 * tb - 0.8989, -0.0033 * tb + 0.0452)
        / perezTerm(1.0, thetaS, cosThetaS, -0.0193 * tb - 0.2592, -0.0665 * tb + 0.0008, -0.0004 * tb + 0.2125, -0.0641 * tb - 0.8989, -0.0033 * tb + 0.0452);
    let cy = yzc
        * perezTerm(cosTheta, gamma, cosGamma, -0.0167 * tb - 0.2608, -0.0950 * tb + 0.0092, -0.0079 * tb + 0.2102, -0.0441 * tb - 1.6537, -0.0109 * tb + 0.0529)
        / perezTerm(1.0, thetaS, cosThetaS, -0.0167 * tb - 0.2608, -0.0950 * tb + 0.0092, -0.0079 * tb + 0.2102, -0.0441 * tb - 1.6537, -0.0109 * tb + 0.0529);
    let safeY = max(cy, 1e-4);
    let xyz = vec3<f32>(cx / safeY * lum, lum, (1.0 - cx - cy) / safeY * lum);
    let rgb = vec3<f32>(
        3.2406 * xyz.x - 1.5372 * xyz.y - 0.4986 * xyz.z,
        -0.9689 * xyz.x + 1.8758 * xyz.y + 0.0415 * xyz.z,
        0.0557 * xyz.x - 0.2040 * xyz.y + 1.0570 * xyz.z,
    );
    return max(rgb, vec3<f32>(0.0));
}

// World direction (x east, y up, z north) for a compass bearing and elevation (radians).
fn bearingDir(bearing: f32, elevation: f32) -> vec3<f32> {
    return vec3<f32>(cos(elevation) * sin(bearing), sin(elevation), cos(elevation) * cos(bearing));
}

// Sky replacement: behind the sky matte, the photo's sky is regraded to an
// analytic one — Preetham daylight from the real sun, domain-warped clouds
// whose cover follows the weather, stars and the moon at night — keeping the
// photograph's own cloud structure (see the end of the body). Only when the
// mood asks for a different sky (night, overcast/storm, fog, golden hour or
// sunrise): a clear midday keeps the photograph's own sky. Directions use the
// same ~90 degree vertical view as viewHorizonY; SunCalc azimuths are from
// south, so a compass bearing is azimuth + pi.
fn semanticSky(
    col: vec3<f32>, uv: vec2<f32>, aspect: f32, t: f32,
    cameraHeading: f32, cameraPitch: f32,
    sunAz: f32, sunAlt: f32, moonAz: f32, moonAlt: f32,
    night: f32, sunrise: f32, rainAmount: f32, snowAmount: f32, fogAmount: f32,
) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.skyReplace <= 0.0) { return col; }
    let sunElev = sin(sunAlt);
    let nightness = clamp(max(night, smoothstep(0.04, -0.12, sunElev)), 0.0, 1.0);
    let cloudiness = clamp(max(max(rainAmount * 0.9, snowAmount * 0.8), fogAmount * 0.7), 0.0, 1.0);
    let golden = smoothstep(0.35, 0.05, sunElev) * (1.0 - nightness);
    let mood = clamp(max(max(nightness, cloudiness), max(golden, sunrise)), 0.0, 1.0);
    if (mood <= 0.001) { return col; }
    let matte = semanticSkyMatte(uv) * mood * clamp(semParams.skyReplace, 0.0, 1.0);
    if (matte <= 0.001) { return col; }

    let heading = cameraHeading * 6.2831853;
    let pitch = (cameraPitch - 0.5) * 3.14159265;
    let fwd = bearingDir(heading, pitch);
    let right = vec3<f32>(cos(heading), 0.0, -sin(heading));
    let up = cross(fwd, right);
    let dir = normalize(fwd + right * ((uv.x - 0.5) * 2.0 * aspect) + up * ((0.5 - uv.y) * 2.0));
    let sunDir = bearingDir(sunAz + 3.14159265, sunAlt);
    let still = clamp(semParams.stillness, 0.0, 1.0);
    let drift = t * (1.0 - still);

    // Day: Preetham, hazier as the weather closes in.
    let turbidity = mix(2.6, 8.0, cloudiness);
    var sky = preethamSky(dir, sunDir, turbidity) * 0.075;
    sky = sky + vec3<f32>(1.0, 0.92, 0.8) * pow(max(dot(dir, sunDir), 0.0), 900.0) * 6.0 * (1.0 - cloudiness);

    // Night: a deep gradient, world-fixed stars, the moon.
    let elev = clamp(dir.y, -0.2, 1.0);
    // In the frame's own (display-referred) range, near applyNight's sky, so
    // the replaced sky does not open a black hole next to the graded photo.
    var nightSkyCol = mix(vec3<f32>(0.07, 0.1, 0.2), vec3<f32>(0.015, 0.025, 0.07), smoothstep(0.0, 0.6, elev));
    let starUv = vec2<f32>(atan2(dir.x, dir.z) * 0.159155 + 0.5, elev) * vec2<f32>(4.0, 2.0);
    nightSkyCol = nightSkyCol + vec3<f32>(0.9, 0.92, 1.0) * starField(starUv, 60.0, drift) * 0.5 * (1.0 - cloudiness);
    let moonDir = bearingDir(moonAz + 3.14159265, moonAlt);
    let moonDisk = smoothstep(0.99985, 0.99993, dot(dir, moonDir)) * select(0.0, 1.0, moonAlt > 0.0);
    nightSkyCol = nightSkyCol + vec3<f32>(0.85, 0.86, 0.8) * moonDisk * 0.8;
    sky = mix(sky, nightSkyCol, nightness);

    // Clouds on a plane above the eye, domain-warped fBm; cover follows the weather.
    let cover = clamp(0.25 + cloudiness * 0.75, 0.0, 1.0);
    let cloudUv = dir.xz / max(dir.y + 0.1, 0.1) * 0.35 + vec2<f32>(drift * 0.004, drift * 0.0015);
    let warp = vec2<f32>(fbm(vec3<f32>(cloudUv * 1.7, 1.3), 2), fbm(vec3<f32>(cloudUv * 1.7 + vec2<f32>(5.2, 1.7), 2.1), 2)) - vec2<f32>(0.5);
    let n = fbm(vec3<f32>((cloudUv + warp * 0.6) * 2.3, 0.4), 3);
    let density = smoothstep(1.0 - cover - 0.1, 1.0 - cover + 0.3, n + 0.15) * smoothstep(-0.02, 0.18, dir.y);
    let sunTint = mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.62, 0.38), max(golden, sunrise));
    let dayCloud = sunTint * mix(0.85, 0.32, cloudiness * cloudiness) * clamp(0.25 + sunElev * 2.0, 0.2, 1.0);
    let cloudCol = mix(dayCloud, vec3<f32>(0.02, 0.022, 0.03), nightness);
    sky = mix(sky, cloudCol, density * 0.7);

    // A regrade, not a cut-out: the photograph's own sky structure (cloud
    // bodies, haze, grain) rides on the new sky as its luma over the photo's
    // mean sky luma (from semParams.skyR/G/B, measured where the map said sky).
    // Clouds stay brighter than the clear sky around them, so where the
    // network read a cloud as something else the seam is a change of colour,
    // not a flat slab against the photograph.
    let photo = dot(textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let skyRef = dot(vec3<f32>(semParams.skyR, semParams.skyG, semParams.skyB), vec3<f32>(0.2126, 0.7152, 0.0722));
    let ratio = select(1.0, clamp(photo / max(skyRef, 0.02), 0.3, 2.5), skyRef > 0.0);
    sky = sky * mix(1.0, ratio, 0.85);

    return mix(col, sky, clamp(matte, 0.0, 1.0) * 0.9);
}

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

    return vec4<f32>(col, 1.0);
}
