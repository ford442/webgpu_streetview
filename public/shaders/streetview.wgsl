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

struct PanoramaUniforms {
    time: f32,
    zoom: f32,
    panX: f32,
    panY: f32,
    transitionProgress: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: PanoramaUniforms;
@group(0) @binding(3) var prevTex: texture_2d<f32>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.zoom;
    // cameraHeadingNorm and cameraPitchNorm are passed through for weather effects
    // but no longer used for UV panning (the panorama is always centered on the view)

    // Apply digital zoom centered on the image
    let center = vec2<f32>(0.5, 0.5);
    var uv = (input.uv - center) / zoom + center;

    // Clamp to prevent edge bleeding on zoom
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

    // Sample the panorama texture
    var color = textureSample(tex, texSampler, clampedUV).rgb;

    // Seamless transition: blend from previous frame with zoom + blur
    let t = uniforms.transitionProgress;
    if (t > 0.0 && t < 1.0) {
        let baseDist = length(input.uv - center);

        // Radial push + zoom on the outgoing frame
        let push = (input.uv - center) * baseDist * 0.15 * t;
        let zoomOld = 1.0 + (2.4 - 1.0) * t;
        let uvOld = (input.uv + push - center) / zoomOld + center;

        // 3-tap diagonal blur for softness
        let res = vec2<f32>(textureDimensions(prevTex));
        let blur = t * (0.006 * 1280.0 / res.x);
        var colorOld = textureSample(prevTex, texSampler, uvOld + vec2<f32>(-blur, -blur));
            colorOld += textureSample(prevTex, texSampler, uvOld + vec2<f32>( blur, -blur));
            colorOld += textureSample(prevTex, texSampler, uvOld);
        colorOld *= 0.333333;

        // Accelerated fade — fast start, smooth landing
        let fade = pow(t, 1.35);
        color = mix(colorOld.rgb, color, fade);

        // Soft vignette during transition
        color = color * (1.0 - baseDist * 0.5 * t);
    }

    // Output to HDR intermediate (color grading and weather applied in post-process)
    return vec4<f32>(color, 1.0);
}
