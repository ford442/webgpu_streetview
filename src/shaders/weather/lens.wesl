import package::lib::noise::hash;
import package::lib::sceneDepth::sceneDepth;
import package::weather::bindings::{linearSampler, p_anamorphicStreak, p_cameraHeading, p_sunAltitude, p_sunAzimuth, sampleScene, sceneTex};
import package::weather::horizon::{normalizedDistance, sceneHorizonY, worldAzimuthToScreenX};

// === 4. LENS EFFECTS (Camera-Aware) ===
fn applyLensFlare(col: vec3<f32>, uv: vec2<f32>, intensity: f32) -> vec3<f32> {
    if (intensity < 0.001) { return col; }
    
    // Use camera-aware coordinate transformation
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
    if (p_anamorphicStreak() > 0.001) {
        let anamorphicY = exp(-dSunY * dSunY * 800.0);    // extremely thin vertically
        let anamorphicX = exp(-dSunX * dSunX * 0.3);       // wide horizontal spread
        let anamorphicColor = vec3<f32>(0.3, 0.5, 1.0);    // blue-tinted anamorphic character
        flare = flare + anamorphicColor * anamorphicY * anamorphicX * p_anamorphicStreak() * sunVisible * 0.4;
    }

    return col + flare * intensity * sunVisible;
}

fn applyChromaticAberration(uv: vec2<f32>, amount: f32) -> vec3<f32> {
    if (amount < 0.001) { 
        return sampleScene(uv).rgb; 
    }
    
    let center = vec2<f32>(0.5);
    let dist = length((uv - center) * vec2<f32>(2.0, 1.0));
    
    let edgeFactor = smoothstep(0.0, 1.0, dist);
    let aberration = amount * edgeFactor * 0.015;
    
    let dir = normalize(uv - center);
    
    let r = sampleScene(uv + dir * aberration).r;
    let g = sampleScene(uv).g;
    let b = sampleScene(uv - dir * aberration * 0.5).b;
    
    return vec3<f32>(r, g, b);
}

fn applyVignette(col: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    let centerDist = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.2, 1.0));
    let vignette = 1.0 - smoothstep(0.5, 1.3, centerDist) * 0.4;
    return col * vignette;
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
