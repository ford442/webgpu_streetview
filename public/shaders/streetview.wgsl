// Streetview shader - panoramic image viewer
// Outputs to HDR intermediate texture for post-processing
// Note: Color grading and weather effects are applied in weather-post.wgsl

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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.y;
    let panX = uniforms.z;
    let panY = uniforms.w;
    
    // Apply zoom and pan for navigation
    let center = vec2<f32>(panX, panY);
    let uv = (input.uv - center) / zoom + center;
    
    // Clamp or wrap UVs for panoramic effect
    let wrappedUV = vec2<f32>(fract(uv.x), clamp(uv.y, 0.0, 1.0));
    
    // Sample the panorama texture
    var color = textureSample(tex, texSampler, wrappedUV).rgb;
    
    // Output to HDR intermediate (color grading and weather applied in post-process)
    return vec4<f32>(color, 1.0);
}
