// transition-zoom-blur.wgsl
// Zoom + 5-tap blur on the outgoing panorama — dreamy departure feel.
//
// The blur radius is resolution-normalized so it looks consistent at all
// canvas sizes (calibrated to a 1280-wide reference).
//
// Bind group layout:
//   @binding(0) uTextureFrom  — snapshot of the departing panorama
//   @binding(1) uTextureTo    — live Google Maps canvas (incoming)
//   @binding(2) uSampler      — linear filtering
//   @binding(3) uniforms      — TransitionUniforms (16 bytes)
//
// Recommended defaults: duration = 500ms, param1 (zoomAmount) = 2.5,
//                       param2 (blurStrength) = 1.1

struct TransitionUniforms {
    progress : f32,
    param1   : f32,   // zoomAmount    — recommended: 2.5
    param2   : f32,   // blurStrength  — recommended: 1.1
    _pad     : f32,
}

@group(0) @binding(0) var uTextureFrom : texture_2d<f32>;
@group(0) @binding(1) var uTextureTo   : texture_2d<f32>;
@group(0) @binding(2) var uSampler     : sampler;
@group(0) @binding(3) var<uniform> uniforms : TransitionUniforms;

struct VertexOutput {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) i : u32) -> VertexOutput {
    let x = f32(i == 1u) * 4.0 - 1.0;
    let y = f32(i == 2u) * 4.0 - 1.0;
    return VertexOutput(
        vec4<f32>(x, y, 0.0, 1.0),
        vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5),
    );
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let center   = vec2<f32>(0.5, 0.5);
    let baseDist = length(in.uv - center);

    let push   = (in.uv - center) * baseDist * 0.18 * uniforms.progress;
    let zoom   = 1.0 + (uniforms.param1 - 1.0) * uniforms.progress;
    let uvFrom = (in.uv + push - center) / zoom + center;

    let colorTo = textureSample(uTextureTo, uSampler, in.uv);

    // Resolution-normalized blur radius — consistent look at all canvas sizes
    // (0.008 * 1280 / res.x gives ~10px at 1280w, ~5px at 2560w)
    let res  = vec2<f32>(textureDimensions(uTextureFrom));
    let blur = uniforms.param2 * uniforms.progress * (0.008 * 1280.0 / res.x);

    // 5-tap diagonal Gaussian-approximation blur on the outgoing panorama
    var colorFrom  = textureSample(uTextureFrom, uSampler, uvFrom + vec2<f32>(-blur, -blur));
        colorFrom += textureSample(uTextureFrom, uSampler, uvFrom + vec2<f32>( blur, -blur));
        colorFrom += textureSample(uTextureFrom, uSampler, uvFrom + vec2<f32>(-blur,  blur));
        colorFrom += textureSample(uTextureFrom, uSampler, uvFrom + vec2<f32>( blur,  blur));
        colorFrom += textureSample(uTextureFrom, uSampler, uvFrom);   // center sample
    colorFrom *= 0.2;

    let fade  = pow(uniforms.progress, 1.35);
    var color = mix(colorFrom, colorTo, fade);
    color     = color * (1.0 - baseDist * 0.6 * uniforms.progress);

    return color;
}
