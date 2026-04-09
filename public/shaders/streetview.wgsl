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
    let panX = uniforms.z;  // 0.5 = centered; offset encodes head look in car mode
    let panY = uniforms.w;  // 0.5 = centered; offset encodes head pitch in car mode

    // Apply head look offset as UV shift (works at all zoom levels).
    // In car mode: panX/panY encode head yaw/pitch offset from 0.5 center.
    // In free mode: panX=panY=0.5, so shiftX=shiftY=0 (no effect).
    let shiftX = panX - 0.5;
    let shiftY = panY - 0.5;

    var uv = input.uv;
    uv.x = uv.x - shiftX;
    uv.y = uv.y - shiftY;

    // Apply zoom centered on the shifted view
    let center = vec2<f32>(0.5, 0.5);
    uv = (uv - center) / zoom + center;

    // Clamp or wrap UVs for panoramic effect
    // Note: In car mode, we clamp horizontally to avoid repeating the limited FOV
    // Google Maps canvas only renders ~90° FOV, so wrapping creates artifacts
    // In free mode, panX/panY are 0.5 (no shift) so clamp vs wrap doesn't matter
    let uClamped = clamp(uv.x, 0.0, 1.0);
    let uWrapped = fract(uv.x);
    
    // Use clamping when there's a significant UV shift (car mode), wrapping otherwise
    // Detect car mode by checking if panX or panY deviates from 0.5
    let isCarMode = abs(panX - 0.5) > 0.001 || abs(panY - 0.5) > 0.001;
    let finalU = select(uWrapped, uClamped, isCarMode);
    
    let wrappedUV = vec2<f32>(finalU, clamp(uv.y, 0.0, 1.0));

    // Sample the panorama texture
    var color = textureSample(tex, texSampler, wrappedUV).rgb;

    // Output to HDR intermediate (color grading and weather applied in post-process)
    return vec4<f32>(color, 1.0);
}
