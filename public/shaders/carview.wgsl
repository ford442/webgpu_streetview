// Car View Streetview shader - panoramic image viewer with post-processing effects
// Effects (rain, sunset, vignette, night, wipers) apply only to the outside view (Street View),
// not to the car interior which is rendered as a separate Three.js overlay.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32((vertexIndex & 1u) * 2u) - 1.0;
    let y = f32((vertexIndex & 2u)) - 1.0;
    output.pos = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return output;
}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: vec4<f32>; // [time, zoom, panX, panY]
@group(0) @binding(3) var<uniform> effects: array<vec4<f32>, 3>;
// effects[0] = [rainIntensity, vignetteStrength, brightness, contrast]
// effects[1] = [tintR, tintG, tintB, nightMode]
// effects[2] = [shaderEffectsEnabled, 0.0, 0.0, 0.0] - shader bypass toggle

// ============================================
// ENHANCED RAIN & WINDSHIELD EFFECTS SYSTEM
// ============================================

// Pseudo-random hash functions
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

fn hash3(p: vec3<f32>) -> f32 {
    let h = dot(p, vec3<f32>(127.1, 311.7, 74.7));
    return fract(sin(h) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    let a = hash(i);
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var freq = 1.0;
    
    for (var i = 0; i < 4; i++) {
        value += amplitude * noise(p * freq);
        amplitude *= 0.5;
        freq *= 2.0;
    }
    return value;
}

// ============================================
// WATER DROP PHYSICS
// ============================================

// Individual water drop with surface tension
fn waterDrop(uv: vec2<f32>, pos: vec2<f32>, size: f32, stretch: f32) -> f32 {
    let toDrop = uv - pos;
    // Stretch for gravity effect
    let stretched = vec2<f32>(toDrop.x, toDrop.y / stretch);
    let dist = length(stretched);
    
    // Surface tension creates rounded top, flat bottom
    let shape = 1.0 - smoothstep(0.0, size, dist);
    
    // Add highlight for 3D effect
    let highlight = smoothstep(size * 0.8, size * 0.3, dist) * 0.3;
    
    return shape * (1.0 + highlight);
}

// Drop trail for running water
fn dropTrail(uv: vec2<f32>, headPos: vec2<f32>, trailLength: f32, width: f32) -> f32 {
    let toPoint = uv - headPos;
    
    // Vertical trail going down
    if (toPoint.y < -trailLength || toPoint.y > 0.0) {
        return 0.0;
    }
    
    // Trail gets wider at bottom (water accumulation)
    let yNorm = abs(toPoint.y) / trailLength;
    let trailWidth = width * (1.0 + yNorm * 0.5);
    
    let xDist = abs(toPoint.x);
    let trailShape = smoothstep(trailWidth, 0.0, xDist);
    
    // Fade at ends
    let fade = smoothstep(0.0, 0.1, yNorm) * (1.0 - smoothstep(0.7, 1.0, yNorm));
    
    return trailShape * fade * 0.7;
}

// ============================================
// MAIN RAIN SYSTEM
// ============================================

// Enhanced rain with all physical effects
fn rainSystem(uv: vec2<f32>, time: f32, intensity: f32, 
              wiperMaskValue: f32, wiperAngle: f32, carSpeed: f32) -> vec4<f32> {
    
    if (intensity < 0.01) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    // Wind effect - rain angles with car speed
    let windAngle = carSpeed * 0.3 * intensity;
    let windOffset = (uv.y * 0.5) * windAngle;
    let rainUV = vec2<f32>(uv.x + windOffset, uv.y);
    
    var rainMask = 0.0;     // Accumulated water mask
    var distortion = vec2<f32>(0.0);  // Refraction offset
    var caustics = 0.0;     // Light focusing through drops
    
    let dropCount = i32(4.0 + intensity * 12.0);
    
    // Phase 1: Static drops (small, stuck to glass)
    for (var i = 0; i < dropCount; i++) {
        let fi = f32(i);
        
        // Drop position with some randomness
        let dropX = fract(hash(vec2<f32>(fi, 1.0)) * 3.7 + fi * 0.1);
        let dropY = fract(hash(vec2<f32>(fi, 2.0)) * 5.3 + fi * 0.15);
        let dropPos = vec2<f32>(dropX, dropY);
        
        // Size variation based on hash
        let baseSize = 0.008 + hash(vec2<f32>(fi, 3.0)) * 0.015;
        
        // Drops accumulate more at bottom (pooling effect)
        let poolFactor = smoothstep(0.0, 1.0, dropY * dropY);
        let size = baseSize * (1.0 + poolFactor * 2.0 * intensity);
        
        // Small drops are more circular, larger ones stretch
        let stretch = 1.0 + poolFactor * 2.0;
        
        // Check if drop was wiped away
        let toDrop = uv - dropPos;
        let distFromWiper = abs(atan2(toDrop.y, toDrop.x) - wiperAngle);
        let inWiperPath = distFromWiper < 0.15 && length(toDrop) < 0.6;
        
        if (!inWiperPath || hash(vec2<f32>(fi, time)) > 0.7) {
            let drop = waterDrop(uv, dropPos, size, stretch);
            
            if (drop > 0.01) {
                rainMask += drop;
                
                // Refraction - bend light through drop
                let refractDir = normalize(toDrop + vec2<f32>(0.0, 0.3));
                distortion += refractDir * drop * size * 30.0;
                
                // Caustics at drop edges
                let edge = smoothstep(size * 0.8, size * 0.9, length(toDrop));
                caustics += edge * drop * 0.5;
            }
        }
    }
    
    // Phase 2: Running water streaks (gravity-driven)
    let streakCount = i32(intensity * 6.0);
    for (var i = 0; i < streakCount; i++) {
        let fi = f32(i + 100);
        
        let streakX = fract(hash(vec2<f32>(fi, 1.0)) * 2.3 + 0.1);
        
        // Streaks start at random heights and run down
        let speed = 0.1 + hash(vec2<f32>(fi, 2.0)) * 0.2;
        let startY = fract(hash(vec2<f32>(fi, 3.0)) + time * speed * 0.1);
        let currentHeadY = 1.0 - fract(startY + time * speed);
        
        let headPos = vec2<f32>(streakX, currentHeadY);
        let trailLen = 0.1 + hash(vec2<f32>(fi, 4.0)) * 0.2 * intensity;
        let width = 0.003 + hash(vec2<f32>(fi, 5.0)) * 0.005;
        
        // Merging: nearby streaks combine
        var mergeBonus = 0.0;
        for (var j = 0; j < streakCount; j++) {
            if (i == j) { continue; }
            let fj = f32(j + 100);
            let otherX = fract(hash(vec2<f32>(fj, 1.0)) * 2.3 + 0.1);
            let xDist = abs(streakX - otherX);
            if (xDist < 0.05 && abs(currentHeadY - (1.0 - fract(hash(vec2<f32>(fj, 3.0)) + time * speed * 0.1))) < 0.1) {
                mergeBonus += 0.5;
            }
        }
        
        let trail = dropTrail(uv, headPos, trailLen, width * (1.0 + mergeBonus));
        rainMask += trail * 0.6;
        
        // Streaks add vertical distortion
        if (trail > 0.01) {
            distortion.y += trail * 0.02;
        }
    }
    
    // Phase 3: Heavy rain sheet flow (during intense rain)
    var sheetFlow = 0.0;
    if (intensity > 0.6) {
        let sheetUV = vec2<f32>(uv.x * 5.0, uv.y * 3.0 - time * 0.5);
        let sheetNoise = fbm(sheetUV);
        sheetFlow = smoothstep(0.4, 0.6, sheetNoise) * (intensity - 0.6) * 0.4;
        
        // Pooling at bottom
        let bottomPool = smoothstep(0.0, 0.3, uv.y) * intensity;
        sheetFlow *= (1.0 + bottomPool);
        
        rainMask += sheetFlow;
        distortion.y += sheetFlow * 0.05;
    }
    
    // Phase 4: Fine mist/spray
    var mist = 0.0;
    if (intensity > 0.4) {
        let mistUV = vec2<f32>(uv.x * 20.0 + time * 0.1, uv.y * 20.0);
        mist = noise(mistUV) * (intensity - 0.4) * 0.15;
        mist *= wiperMaskValue; // Mist is cleared by wipers
        rainMask += mist * 0.3;
    }
    
    // Apply wiper mask to rain mask
    rainMask *= wiperMaskValue;
    distortion *= wiperMaskValue;
    caustics *= wiperMaskValue;
    
    // Clamp mask
    rainMask = clamp(rainMask, 0.0, 1.0);
    
    return vec4<f32>(rainMask, distortion.x, distortion.y, caustics);
}

// ============================================
// INTERIOR CONDENSATION (Fogging)
// ============================================

fn condensation(uv: vec2<f32>, time: f32, intensity: f32) -> f32 {
    if (intensity < 0.05) {
        return 0.0;
    }
    
    // Multiple layers of fog
    let fog1 = noise(uv * 8.0 + time * 0.02);
    let fog2 = noise(uv * 16.0 - time * 0.03);
    let fog3 = noise(uv * 32.0 + time * 0.01);
    
    // Combine layers
    let fog = fog1 * 0.5 + fog2 * 0.3 + fog3 * 0.2;
    
    // Fog accumulates at edges and bottom
    let edgeDist = min(min(uv.x, 1.0 - uv.x), uv.y);
    let edgeFactor = 1.0 - smoothstep(0.0, 0.3, edgeDist);
    
    return fog * edgeFactor * intensity;
}

// ============================================
// WIPER ENHANCED EFFECTS
// ============================================

// Calculate wiper position and cleared area
fn calculateWiperState(time: f32, speed: f32, wiperIndex: i32) -> vec3<f32> {
    let cycle = time * speed;
    
    // Phase offset for dual wipers
    let phaseOffset = select(0.0, 3.14159, wiperIndex == 1);
    let angle = sin(cycle + phaseOffset);
    
    // Angular velocity (for blade direction)
    let angularVel = cos(cycle + phaseOffset) * speed;
    
    return vec3<f32>(angle, angularVel, f32(wiperIndex));
}

// Enhanced wiper mask with water push effect
fn wiperMaskEnhanced(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> vec2<f32> {
    if (enabled < 0.5) {
        return vec2<f32>(1.0, 0.0); // Full rain, no wiper angle
    }
    
    // Wiper pivots farther apart near the edges of the windshield
    let leftPivot = vec2<f32>(0.12, 0.0);
    let rightPivot = vec2<f32>(0.88, 0.0);
    
    let cycle = time * speed;
    // Full 180 degree sweep (PI radians) - wipers go from pointing down to pointing up
    let maxSweep = 3.14159;
    
    // Left wiper
    let leftAngle = sin(cycle) * maxSweep;
    let toLeft = uv - leftPivot;
    let leftDist = length(toLeft);
    let leftUVAngle = atan2(toLeft.y, toLeft.x);
    
    // Right wiper
    let rightAngle = sin(cycle + 3.14159) * maxSweep;
    let toRight = uv - rightPivot;
    let rightDist = length(toRight);
    let rightUVAngle = atan2(toRight.y, toRight.x);
    
    // Check if cleared by either wiper
    var cleared = 0.0;
    var activeWiperAngle = 0.0;
    
    // Left wiper area - extended reach for full sweep
    if (leftDist < 0.9 && leftDist > 0.05 && uv.y < 0.95) {
        let angleDiff = abs(leftUVAngle - leftAngle);
        let wrappedDiff = select(angleDiff, 6.28318 - angleDiff, angleDiff > 3.14159);
        
        // Cleared area trails behind blade
        let trailWidth = 0.6; // Radians of cleared area
        let clearance = smoothstep(trailWidth, 0.0, wrappedDiff);
        
        // Water accumulates over time after wiper passes
        let accumulation = fract(cycle / 6.28318 + 0.5);
        let timeSinceWiped = accumulation * (1.0 + wrappedDiff * 2.0);
        let rainReturn = smoothstep(0.0, 0.7, timeSinceWiped);
        
        if (clearance > 0.01) {
            cleared = max(cleared, clearance * (1.0 - rainReturn * 0.9));
            activeWiperAngle = leftAngle;
        }
    }
    
    // Right wiper area - extended reach for full sweep
    if (rightDist < 0.9 && rightDist > 0.05 && uv.y < 0.95) {
        let angleDiff = abs(rightUVAngle - rightAngle);
        let wrappedDiff = select(angleDiff, 6.28318 - angleDiff, angleDiff > 3.14159);
        
        let trailWidth = 0.6;
        let clearance = smoothstep(trailWidth, 0.0, wrappedDiff);
        
        let accumulation = fract((cycle + 3.14159) / 6.28318 + 0.5);
        let timeSinceWiped = accumulation * (1.0 + wrappedDiff * 2.0);
        let rainReturn = smoothstep(0.0, 0.7, timeSinceWiped);
        
        if (clearance > 0.01) {
            cleared = max(cleared, clearance * (1.0 - rainReturn * 0.9));
        }
    }
    
    // Return mask value and wiper angle
    return vec2<f32>(1.0 - cleared * 0.95, activeWiperAngle);
}

// Wiper water push - water piles up at blade edge
fn wiperWaterPush(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> f32 {
    if (enabled < 0.5) {
        return 0.0;
    }
    
    // Farther apart pivots
    let leftPivot = vec2<f32>(0.12, 0.0);
    let rightPivot = vec2<f32>(0.88, 0.0);
    let cycle = time * speed;
    // Full 180 degree sweep
    let maxSweep = 3.14159;
    let leftAngle = sin(cycle) * maxSweep;
    let rightAngle = sin(cycle + 3.14159) * maxSweep;
    let angularVel = cos(cycle) * speed;
    
    // Calculate for both wipers
    var totalPush = 0.0;
    
    // Left wiper push
    let toLeft = uv - leftPivot;
    let leftAngleUV = atan2(toLeft.y, toLeft.x);
    let distLeft = length(toLeft);
    
    if (distLeft < 0.9 && distLeft > 0.05 && uv.y < 0.95) {
        let angleDiff = leftAngleUV - leftAngle;
        let wrappedDiff = select(angleDiff, angleDiff + 6.28318, angleDiff < -3.14159);
        let wrappedDiff2 = select(wrappedDiff, wrappedDiff - 6.28318, wrappedDiff > 3.14159);
        let pushZone = smoothstep(0.0, 0.15, wrappedDiff2) * smoothstep(0.25, 0.15, wrappedDiff2);
        totalPush += pushZone * abs(angularVel) * 0.3;
    }
    
    // Right wiper push
    let toRight = uv - rightPivot;
    let rightAngleUV = atan2(toRight.y, toRight.x);
    let distRight = length(toRight);
    
    if (distRight < 0.9 && distRight > 0.05 && uv.y < 0.95) {
        let angleDiff = rightAngleUV - rightAngle;
        let wrappedDiff = select(angleDiff, angleDiff + 6.28318, angleDiff < -3.14159);
        let wrappedDiff2 = select(wrappedDiff, wrappedDiff - 6.28318, wrappedDiff > 3.14159);
        let pushZone = smoothstep(0.0, 0.15, wrappedDiff2) * smoothstep(0.25, 0.15, wrappedDiff2);
        totalPush += pushZone * abs(angularVel) * 0.3;
    }
    
    return totalPush;
}

// Legacy water push for single wiper (kept for compatibility)
fn wiperWaterPushSingle(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> f32 {
    if (enabled < 0.5) {
        return 0.0;
    }
    
    let leftPivot = vec2<f32>(0.12, 0.0);
    let cycle = time * speed;
    let maxSweep = 3.14159;
    let leftAngle = sin(cycle) * maxSweep;
    let angularVel = cos(cycle) * speed;
    
    let toUV = uv - leftPivot;
    let uvAngle = atan2(toUV.y, toUV.x);
    let distFromPivot = length(toUV);
    
    if (distFromPivot > 0.9 || distFromPivot < 0.05 || uv.y > 0.95) {
        return 0.0;
    }
    
    // Water piles up ahead of moving blade
    let angleDiff = uvAngle - leftAngle;
    let wrappedDiff = select(angleDiff, angleDiff + 6.28318, angleDiff < -3.14159);
    let wrappedDiff2 = select(wrappedDiff, wrappedDiff - 6.28318, wrappedDiff > 3.14159);
    
    // Push direction based on wiper movement
    let pushZone = smoothstep(0.0, 0.15, wrappedDiff2) * smoothstep(0.25, 0.15, wrappedDiff2);
    let pushIntensity = abs(angularVel) * 0.3;
    
    return pushZone * pushIntensity;
}

// ============================================
// LEGACY FUNCTIONS (maintain compatibility)
// ============================================

// Legacy rain drop effect - replaced by rainSystem
fn rainDrop(uv: vec2<f32>, time: f32, intensity: f32) -> vec3<f32> {
    // Delegate to new system with default parameters
    let result = rainSystem(uv, time, intensity, 1.0, 0.0, 0.0);
    
    // Return rain color with caustics
    let rainColor = result.x * 0.15;
    let caustics = result.w * 0.1;
    
    return vec3<f32>(rainColor + caustics);
}

// Legacy wiper mask - replaced by wiperMaskEnhanced
fn wiperMask(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> f32 {
    let result = wiperMaskEnhanced(uv, time, enabled, speed);
    return result.x;
}

// Windshield wiper blade visual effect - dual wipers
fn wiperBlade(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> vec3<f32> {
    if (enabled < 0.5) {
        return vec3<f32>(0.0);
    }
    
    let cycle = time * speed;
    
    // Left wiper pivot (driver's side) - farther apart
    let leftPivot = vec2<f32>(0.12, 0.0);
    // Right wiper pivot (passenger side) - farther apart
    let rightPivot = vec2<f32>(0.88, 0.0);
    
    // Full 180 degree sweep (PI radians) - wipers go from pointing down to pointing up
    let maxSweepAngle = 3.14159;
    let leftAngle = sin(cycle) * maxSweepAngle;
    let rightAngle = sin(cycle + 3.14159) * maxSweepAngle;
    
    // Blade parameters - extended reach for full sweep coverage
    let bladeLength = 0.9;
    let bladeWidth = 0.008;
    
    var bladeColor = vec3<f32>(0.0);
    
    // Left wiper blade
    let toLeft = uv - leftPivot;
    let distLeft = length(toLeft);
    if (distLeft <= bladeLength && distLeft >= 0.05) {
        let leftUvAngle = atan2(toLeft.y, toLeft.x);
        let leftDiff = abs(leftUvAngle - leftAngle);
        let leftDiffWrapped = select(leftDiff, 6.28318 - leftDiff, leftDiff > 3.14159);
        if (leftDiffWrapped < bladeWidth) {
            let intensity = 1.0 - smoothstep(0.0, bladeWidth, leftDiffWrapped);
            bladeColor += vec3<f32>(0.04, 0.04, 0.04) * intensity * 0.9;
        }
    }
    
    // Right wiper blade
    let toRight = uv - rightPivot;
    let distRight = length(toRight);
    if (distRight <= bladeLength && distRight >= 0.05) {
        let rightUvAngle = atan2(toRight.y, toRight.x);
        let rightDiff = abs(rightUvAngle - rightAngle);
        let rightDiffWrapped = select(rightDiff, 6.28318 - rightDiff, rightDiff > 3.14159);
        if (rightDiffWrapped < bladeWidth) {
            let intensity = 1.0 - smoothstep(0.0, bladeWidth, rightDiffWrapped);
            bladeColor += vec3<f32>(0.04, 0.04, 0.04) * intensity * 0.9;
        }
    }
    
    return bladeColor;
}

// ============================================
// MAIN FRAGMENT SHADER
// ============================================

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = uniforms.x;
    let zoom = uniforms.y;
    let panX = uniforms.z;
    let panY = uniforms.w;
    
    // Check for shader bypass mode
    let shaderEffectsEnabled = effects[2].x;
    if (shaderEffectsEnabled < 0.5) {
        // Render raw Street View without any effects
        let center = vec2<f32>(panX, panY);
        let uv = (input.uv - center) / zoom + center;
        let wrappedUV = vec2<f32>(fract(uv.x), clamp(uv.y, 0.0, 1.0));
        return textureSample(tex, texSampler, wrappedUV);
    }
    
    // Apply zoom and pan for navigation
    let center = vec2<f32>(panX, panY);
    let uv = (input.uv - center) / zoom + center;
    let wrappedUV = vec2<f32>(fract(uv.x), clamp(uv.y, 0.0, 1.0));
    
    // Extract effect parameters
    let rainIntensity = effects[0].x;
    let vignetteStrength = effects[0].y;
    let brightness = effects[0].z;
    let contrast = effects[0].w;
    let tintR = effects[1].x;
    let tintG = effects[1].y;
    let tintB = effects[1].z;
    let nightMode = effects[1].w;
    
    // Wiper parameters
    let wiperEnabled = rainIntensity > 0.1 ? 1.0 : 0.0;
    let wiperSpeed = 2.0 + rainIntensity * 2.0;
    
    // Car speed affects rain angle (simulated)
    let carSpeed = 0.5 + rainIntensity * 0.5;
    
    // Calculate enhanced wiper mask
    let wiperResult = wiperMaskEnhanced(input.uv, time, wiperEnabled, wiperSpeed);
    let wiperMaskValue = wiperResult.x;
    let wiperAngle = wiperResult.y;
    
    // ============================================
    // SAMPLE BASE TEXTURE WITH REFRACTION
    // ============================================
    
    // Get rain system results for refraction
    let rainResult = rainSystem(input.uv, time, rainIntensity, wiperMaskValue, wiperAngle, carSpeed);
    let rainMask = rainResult.x;
    let rainDistortion = rainResult.yz;
    let rainCaustics = rainResult.w;
    
    // Apply water refraction to UVs
    let refractedUV = wrappedUV + rainDistortion * 0.02;
    var color = textureSample(tex, texSampler, refractedUV).rgb;
    
    // ============================================
    // APPLY RAIN VISUALS
    // ============================================
    
    // Add water droplet highlights and caustics
    let dropHighlight = rainMask * 0.08;
    let causticLight = rainCaustics * 0.15 * (1.0 + rainIntensity);
    color += vec3<f32>(dropHighlight + causticLight);
    
    // Wiper water push effect
    let waterPush = wiperWaterPush(input.uv, time, wiperEnabled, wiperSpeed);
    color += vec3<f32>(waterPush * 0.05);
    
    // Add wiper blade visual
    let blade = wiperBlade(input.uv, time, wiperEnabled, wiperSpeed);
    color = mix(color, blade, length(blade) > 0.0 ? 0.9 : 0.0);
    
    // ============================================
    // INTERIOR CONDENSATION
    // ============================================
    
    // Condensation increases with humidity (simulated by rain intensity)
    let humidity = rainIntensity * 0.7;
    let fog = condensation(input.uv, time, humidity);
    
    // Fog desaturates and lightens the view
    let fogColor = vec3<f32>(0.7, 0.75, 0.8);
    color = mix(color, fogColor, fog * 0.4);
    
    // ============================================
    // POST-PROCESSING
    // ============================================
    
    // Apply color grading (time of day tint)
    color *= vec3<f32>(tintR, tintG, tintB);
    
    // Apply brightness
    color *= brightness;
    
    // Apply contrast
    color = (color - vec3<f32>(0.5)) * contrast + vec3<f32>(0.5);
    
    // Apply night mode (simulated headlights)
    if (nightMode > 0.5) {
        let headlightUV = input.uv - vec2<f32>(0.5, 0.6);
        let headlightDist = length(headlightUV * vec2<f32>(1.0, 1.5));
        let headlight = smoothstep(0.5, 0.0, headlightDist) * 0.6;
        color += vec3<f32>(headlight * 0.9, headlight * 0.85, headlight * 0.7);
    }
    
    // Apply vignette (edge darkening)
    if (vignetteStrength > 0.01) {
        let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
        let vignette = 1.0 - smoothstep(0.3, 0.9, dist) * vignetteStrength;
        color *= vignette;
    }
    
    // Clamp final output
    color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    
    return vec4<f32>(color, 1.0);
}
