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
    panX: f32,             // current normalized heading (0–1)
    panY: f32,             // current normalized pitch  (0–1)
    transitionProgress: f32,
    movementHeading: f32,  // normalized heading towards the next node (0–1)
    capturePanX: f32,      // panX at snapshot capture time
    capturePanY: f32,      // panY at snapshot capture time
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: PanoramaUniforms;
@group(0) @binding(3) var prevTex: texture_2d<f32>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.zoom;
    let center = vec2<f32>(0.5, 0.5);

    // Apply digital zoom centered on the image
    var uv = (input.uv - center) / zoom + center;
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

    // Sample live feed — Google Maps renders at the current heading/pitch, no UV shift needed
    var color = textureSample(tex, texSampler, clampedUV).rgb;

    // World-space look-around transition
    let t = uniforms.transitionProgress;
    if (t > 0.0 && t < 1.0) {
        // Heading delta between current look direction and snapshot capture direction.
        // At zoom=1 Google Maps shows ~90° horizontal FOV → scale 4.0 maps a full
        // 90° look to a 1.0 UV shift. Divided by zoom because wider zoom already
        // expanded the UV range.
        let lookScaleH = 4.0 / uniforms.zoom;
        let lookScaleV = 2.8 / uniforms.zoom;
        let deltaX = (uniforms.panX - uniforms.capturePanX) * lookScaleH;
        let deltaY = (uniforms.panY - uniforms.capturePanY) * lookScaleV;

        // Forward motion: zoom in and shift the zoom center towards the movement direction
        let zoomOld = 1.0 + t * 1.4;
        let pushX = (uniforms.movementHeading - uniforms.capturePanX) * t * 0.35;

        // UV into the previous panorama: look-around delta + forward push + zoom
        let uvPrev = (uv - center - vec2<f32>(deltaX + pushX, deltaY)) / zoomOld + center;

        // 3-tap diagonal blur for softness (increases as old frame zooms)
        let res = vec2<f32>(textureDimensions(prevTex));
        let blur = t * (0.006 * 1280.0 / res.x);
        var colorOld = textureSample(prevTex, texSampler, uvPrev + vec2<f32>(-blur, -blur));
            colorOld += textureSample(prevTex, texSampler, uvPrev + vec2<f32>( blur, -blur));
            colorOld += textureSample(prevTex, texSampler, uvPrev);
        colorOld *= 0.333333;

        // Accelerated fade — fast start keeps old panorama visible while tiles load,
        // then snaps to new view in the final quarter of the transition.
        let fade = pow(t, 1.35);
        color = mix(colorOld.rgb, color, fade);

        // Soft vignette to mask edge stretching at high look-around angles
        let baseDist = length(input.uv - center);
        color = color * (1.0 - baseDist * 0.5 * t);
    }

    // Output to HDR intermediate (color grading and weather applied in weather-post.wgsl)
    return vec4<f32>(color, 1.0);
}
