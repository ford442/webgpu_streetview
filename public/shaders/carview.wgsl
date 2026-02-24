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
@group(0) @binding(3) var<uniform> effects: array<vec4<f32>, 2>;
// effects[0] = [rainIntensity, vignetteStrength, brightness, contrast]
// effects[1] = [tintR, tintG, tintB, nightMode]

// Wiper uniforms passed through effects array (reusing unused slots)
// effects[0].w = wiperEnabled (1.0 or 0.0)
// effects[1].w = wiperPhase (0.0 to 1.0, calculated from time and speed)

// Pseudo-random hash function
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

// Rain drop effect
fn rainDrop(uv: vec2<f32>, time: f32, intensity: f32) -> vec3<f32> {
    if (intensity < 0.01) {
        return vec3<f32>(0.0);
    }
    
    var rain = vec3<f32>(0.0);
    let dropCount = intensity * 8.0;
    
    for (var i = 0; i < 8; i++) {
        let fi = f32(i);
        if (fi >= dropCount) { break; }
        
        let dropUV = vec2<f32>(
            fract(uv.x * (2.0 + fi) + fi * 0.3),
            fract(uv.y * (3.0 + fi * 0.5) + time * (0.5 + fi * 0.1))
        );
        
        let dist = distance(dropUV, vec2<f32>(0.5, 0.5));
        let streak = smoothstep(0.02, 0.0, abs(dropUV.x - 0.5)) * 
                     smoothstep(0.4, 0.0, abs(dropUV.y - 0.3));
        rain += vec3<f32>(streak * 0.08 * intensity);
    }
    
    return rain;
}

// Windshield wiper effect
// Returns a mask value (0.0 = fully wiped/clear, 1.0 = rainy)
fn wiperMask(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> f32 {
    if (enabled < 0.5) {
        return 1.0; // No wiping, full rain
    }
    
    // Wiper pivot point (bottom center of windshield)
    let pivot = vec2<f32>(0.5, 0.0);
    
    // Calculate wiper angle - oscillating motion
    // Speed affects how fast the wipers sweep
    let cycle = time * speed;
    // Use sine for smooth oscillation: -1 to 1, mapped to angle range
    let angle = sin(cycle) * 0.8; // Oscillates between -0.8 and 0.8 radians
    
    // Calculate vector from pivot to current UV
    let toUV = uv - pivot;
    let distFromPivot = length(toUV);
    
    // Only affect area within wiper reach (windshield area)
    // Windshield typically covers bottom half and extends up
    if (distFromPivot > 0.7 || uv.y > 0.85) {
        return 1.0; // Outside wiper range
    }
    
    // Calculate angle of current UV from pivot
    let uvAngle = atan2(toUV.y, toUV.x);
    
    // Wiper blade width (in radians)
    let bladeWidth = 0.08;
    
    // Check if this pixel is within the wiper blade sweep
    // The wiper clears a path as it moves, leaving a "trail"
    // We simulate this by checking if the pixel is behind the current wiper position
    
    // Current wiper position angle
    let wiperPos = angle;
    
    // Distance from current wiper position
    let angleDiff = abs(uvAngle - wiperPos);
    // Handle angle wrapping
    if (angleDiff > 3.14159) {
        angleDiff = 6.28318 - angleDiff;
    }
    
    // Check if within blade width
    let inBlade = angleDiff < bladeWidth;
    
    // Check if this area has been "cleared" by the wiper
    // The wiper clears everything in its sweep path up to current position
    // We simulate cleared area by checking if the pixel was swept over recently
    
    // Create a "clear zone" that follows the wiper
    // This is a simplified model: the area gets cleared and gradually gets rainy again
    
    // Distance along the wiper arc
    let arcDist = abs(uvAngle - angle);
    if (arcDist > 3.14159) {
        arcDist = 6.28318 - arcDist;
    }
    
    // The wiper clears a wedge-shaped area
    // When the wiper passes over, it clears immediately
    // Then rain gradually accumulates again
    
    // Simple model: if the wiper blade just passed, it's clear
    // Use a time-based accumulation based on wiper speed
    let clearTime = 1.0 / speed; // Time for one sweep
    let accumulation = fract(cycle / 6.28318); // 0 to 1 over one full cycle
    
    // Distance from the wiper's current position
    let distFromWiper = abs(uvAngle - angle);
    if (distFromWiper > 3.14159 {
        distFromWiper = 6.28318 - distFromWiper;
    }
    
    // Create the cleared area mask
    // Immediately behind the wiper is clear (0.0)
    // As we get further from the wiper, rain accumulates back to 1.0
    let cleared = smoothstep(0.5, 0.0, distFromWiper);
    
    // Add some randomness to make it look more natural
    let noise = hash(uv * 100.0 + time);
    cleared = mix(cleared, cleared * (0.8 + noise * 0.2), 0.3);
    
    // The mask: 0.0 = clear (wiped), 1.0 = rainy
    return 1.0 - cleared * 0.9;
}

// Windshield wiper blade visual effect
// Draws the actual wiper blade on screen
fn wiperBlade(uv: vec2<f32>, time: f32, enabled: f32, speed: f32) -> vec3<f32> {
    if (enabled < 0.5) {
        return vec3<f32>(0.0);
    }
    
    // Wiper pivot point
    let pivot = vec2<f32>(0.5, 0.0);
    
    // Calculate wiper angle
    let cycle = time * speed;
    let angle = sin(cycle) * 0.8;
    
    // Vector from pivot to current UV
    let toUV = uv - pivot;
    let distFromPivot = length(toUV);
    
    // Wiper blade parameters
    let bladeLength = 0.65;
    let bladeWidth = 0.008;
    
    // Only draw within blade length
    if (distFromPivot > bladeLength || distFromPivot < 0.05) {
        return vec3<f32>(0.0);
    }
    
    // Calculate angle to current UV
    let uvAngle = atan2(toUV.y, toUV.x);
    
    // Distance from wiper angle
    let angleDiff = abs(uvAngle - angle);
    if (angleDiff > 3.14159) {
        angleDiff = 6.28318 - angleDiff;
    }
    
    // Check if within blade width
    if (angleDiff < bladeWidth) {
        // Blade intensity based on distance from center
        let bladeIntensity = 1.0 - smoothstep(0.0, bladeWidth, angleDiff);
        
        // Dark rubber blade with slight transparency at edges
        return vec3<f32>(0.05, 0.05, 0.05) * bladeIntensity * 0.8;
    }
    
    return vec3<f32>(0.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let time = uniforms.x;
    let zoom = uniforms.y;
    let panX = uniforms.z;
    let panY = uniforms.w;
    
    // Apply zoom and pan for navigation
    let center = vec2<f32>(panX, panY);
    let uv = (input.uv - center) / zoom + center;
    let wrappedUV = vec2<f32>(fract(uv.x), clamp(uv.y, 0.0, 1.0));
    
    var color = textureSample(tex, texSampler, wrappedUV).rgb;
    
    // Extract effect parameters
    let rainIntensity = effects[0].x;
    let vignetteStrength = effects[0].y;
    let brightness = effects[0].z;
    let contrast = effects[0].w;
    let tintR = effects[1].x;
    let tintG = effects[1].y;
    let tintB = effects[1].z;
    let nightMode = effects[1].w;
    
    // Wiper parameters (passed in uniforms)
    // We'll use the panY uniform's fractional part for wiper phase
    let wiperEnabled = rainIntensity > 0.1 ? 1.0 : 0.0; // Auto-enable wipers when raining
    let wiperSpeed = 2.0 + rainIntensity * 2.0; // Speed increases with rain intensity
    
    // Calculate wiper mask (clears rain in swept area)
    let wiperMaskValue = wiperMask(input.uv, time, wiperEnabled, wiperSpeed);
    
    // Apply rain effect
    let rain = rainDrop(input.uv, time, rainIntensity * wiperMaskValue);
    color += rain;
    
    // Add wiper blade visual
    let blade = wiperBlade(input.uv, time, wiperEnabled, wiperSpeed);
    color = mix(color, blade, length(blade) > 0.0 ? 0.9 : 0.0);
    
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
