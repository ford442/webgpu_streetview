// Streetview shader - panoramic image viewer
// Outputs to HDR intermediate texture for post-processing
// Note: Color grading and weather effects are applied in weather-post.wgsl
//
// Transition support: When transitionProgress is between 0.0 and 1.0,
// the shader mixes between previousFrameTexture (old panorama) and
// tex (current panorama) with a zoom effect on the outgoing frame.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct PanoramaUniforms {
    time: f32,
    zoom: f32,
    cameraHeadingNorm: f32,
    cameraPitchNorm: f32,
    transitionProgress: f32,
    transitionZoomAmount: f32,
    transitionBlurStrength: f32,
    _pad: f32,
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
@group(0) @binding(2) var<uniform> uniforms: PanoramaUniforms;
@group(0) @binding(3) var previousFrameTexture: texture_2d<f32>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.zoom;
    let center = vec2<f32>(0.5, 0.5);

    // Apply digital zoom centered on the image
    var uv = (input.uv - center) / zoom + center;
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

    // Sample live feed — Google Maps renders at the current heading/pitch, no UV shift needed
    var color = textureSample(tex, texSampler, clampedUV).rgb;

    // === TRANSITION: Mix with previous frame ===
    let t = uniforms.transitionProgress;
    if (t > 0.0 && t < 1.0) {
        // Zoom the outgoing (previous) panorama toward the vanishing point
        let transitionZoom = 1.0 + (uniforms.transitionZoomAmount - 1.0) * t;
        let prevUV = (input.uv - center) / transitionZoom + center;
        let prevClampedUV = clamp(prevUV, vec2<f32>(0.0), vec2<f32>(1.0));

        // Sample the previous frame
        var prevColor = textureSample(previousFrameTexture, texSampler, prevClampedUV).rgb;

        // Optional: Apply a subtle blur to the previous frame during transition
        // This creates a dreamy "departing" feel
        if (uniforms.transitionBlurStrength > 0.0) {
            let res = vec2<f32>(textureDimensions(previousFrameTexture));
            let blur = uniforms.transitionBlurStrength * t * (0.008 * 1280.0 / res.x);

            // 4-tap additional blur samples
            var blurSample = textureSample(previousFrameTexture, texSampler, clamp(prevUV + vec2<f32>(-blur, -blur), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
            blurSample += textureSample(previousFrameTexture, texSampler, clamp(prevUV + vec2<f32>( blur, -blur), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
            blurSample += textureSample(previousFrameTexture, texSampler, clamp(prevUV + vec2<f32>(-blur,  blur), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
            blurSample += textureSample(previousFrameTexture, texSampler, clamp(prevUV + vec2<f32>( blur,  blur), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
            blurSample *= 0.25;

            // Blend between sharp and blurred previous frame
            prevColor = mix(prevColor, blurSample, t * 0.5);
        }

        // Smooth fade curve (slightly accelerated)
        let fade = pow(t, 1.4);

        // Mix previous (outgoing) and current (incoming) panoramas
        color = mix(prevColor, color, fade);

        // Subtle vignette during transition to focus attention on center
        let baseDist = length(input.uv - center);
        color = color * (1.0 - baseDist * 0.55 * t);
    }

    // Output to HDR intermediate (color grading and weather applied in weather-post.wgsl)
    return vec4<f32>(color, 1.0);
}
