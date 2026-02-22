// Car View Streetview shader - panoramic image viewer with post-processing effects
// Effects (rain, sunset, vignette, night) apply only to the outside view (Street View),
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
    
    // Apply rain effect
    let rain = rainDrop(input.uv, time, rainIntensity);
    color += rain;
    
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
