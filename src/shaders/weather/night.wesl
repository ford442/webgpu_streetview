import package::lib::noise::hash;
import package::weather::bindings::{p_cameraHeading, p_sunAzimuth};
import package::weather::horizon::{normalizedDistance, sceneHorizonY, worldAzimuthToScreenX};

// Nighttime/starfield, headlights, cabin lighting and the astronomical
// (sunset/sunrise/moonlight) effects of the weather post-process.

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

// Sunrise wash. Anchored to the *tracked* horizon line and the sun's actual
// screen azimuth so it pans with the camera exactly like sunsetHorizonGlow —
// previously it was pinned to uv.y 0.5 and ignored heading entirely, which made
// dawn light stay glued to the same corner of the screen while you turned.
fn applySunrise(col: vec3<f32>, uv: vec2<f32>, sunrise: f32) -> vec3<f32> {
    if (sunrise < 0.001) { return col; }

    let horizonY = sceneHorizonY();
    let sunScreenX = worldAzimuthToScreenX(p_sunAzimuth(), p_cameraHeading());
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
