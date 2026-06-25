// Streetview shader - panoramic image viewer
// Outputs to HDR intermediate texture for post-processing
// Note: Color grading and weather effects are applied in weather-post.wgsl
//
// Transition support:
// - holdActive: freeze on previousFrameTexture while the next panorama loads
// - Look-around: UV shift on the frozen frame from heading/pitch delta
// - Release: simple crossfade (no zoom/blur) when transitionProgress goes 0→1

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct PanoramaUniforms {
    time: f32,
    zoom: f32,
    panX: f32,              // current normalized heading (0–1)
    panY: f32,              // current normalized pitch  (0–1)
    transitionProgress: f32,
    holdActive: f32,        // 1.0 = freeze on previous frame
    capturePanX: f32,       // panX at snapshot capture time
    capturePanY: f32,       // panY at snapshot capture time
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

// Wrap heading delta across the 0/1 seam (e.g. 350° → 10° = +20°, not -340°)
fn wrapDelta(a: f32, b: f32) -> f32 {
    var d = a - b;
    if (d > 0.5) { d -= 1.0; }
    if (d < -0.5) { d += 1.0; }
    return d;
}

fn samplePrevWithLookAround(baseUV: vec2<f32>) -> vec3<f32> {
    let lookScaleH = 4.0 / uniforms.zoom;
    let lookScaleV = 2.8 / uniforms.zoom;
    let deltaX = wrapDelta(uniforms.panX, uniforms.capturePanX) * lookScaleH;
    let deltaY = (uniforms.panY - uniforms.capturePanY) * lookScaleV;
    let prevUV = clamp(baseUV - vec2<f32>(deltaX, deltaY), vec2<f32>(0.0), vec2<f32>(1.0));
    return textureSample(previousFrameTexture, texSampler, prevUV).rgb;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.zoom;
    let center = vec2<f32>(0.5, 0.5);

    // Apply digital zoom centered on the image
    var uv = (input.uv - center) / zoom + center;
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

    let t = uniforms.transitionProgress;
    let holding = uniforms.holdActive > 0.5;

    var color: vec3<f32>;
    if (holding) {
        // Pause: only sample the GPU snapshot — never touch the live tex binding
        color = samplePrevWithLookAround(uv);
    } else {
        // Live feed — Google Maps renders at the current heading/pitch, no UV shift needed
        color = textureSample(tex, texSampler, clampedUV).rgb;
        if (t > 0.0 && t < 1.0) {
            // Release: clean crossfade from held frame to the new live panorama
            let prevColor = samplePrevWithLookAround(uv);
            let fade = pow(t, 1.2);
            color = mix(prevColor, color, fade);
        }
    }

    return vec4<f32>(color, 1.0);
}
