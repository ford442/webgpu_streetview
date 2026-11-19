// transition-zoom-chromatic.wgsl
// Zoom + chromatic aberration — filmic / dreamy departure.
//
// R, G, and B channels of the outgoing panorama are sampled at slightly
// offset UVs.  The blue channel receives a small vertical offset as well as
// horizontal for a more optical-lens-like look.
//
// Bind group layout:
//   @binding(0) uTextureFrom  — snapshot of the departing panorama
//   @binding(1) uTextureTo    — live Google Maps canvas (incoming)
//   @binding(2) uSampler      — linear filtering
//   @binding(3) uniforms      — TransitionUniforms (16 bytes)
//
// Recommended defaults: duration = 500ms, param1 (zoomAmount) = 2.5,
//                       param2 (aberrationStrength) = 1.0

struct TransitionUniforms {
    progress : f32,
    param1   : f32,   // zoomAmount         — recommended: 2.5
    param2   : f32,   // aberrationStrength — recommended: 1.0
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

    let push   = (in.uv - center) * baseDist * 0.2 * uniforms.progress;
    let zoom   = 1.0 + (uniforms.param1 - 1.0) * uniforms.progress;
    let uvFrom = (in.uv + push - center) / zoom + center;

    let colorTo = textureSample(uTextureTo, uSampler, in.uv);

    // RGB channel split with diagonal B-channel offset for optical-lens realism
    let aberr = uniforms.param2 * uniforms.progress * 0.012;
    let r = textureSample(uTextureFrom, uSampler, uvFrom + vec2<f32>( aberr,           0.0)).r;
    let g = textureSample(uTextureFrom, uSampler, uvFrom).g;
    let b = textureSample(uTextureFrom, uSampler, uvFrom - vec2<f32>(aberr * 0.8, aberr * 0.3)).b;

    var colorFrom = vec4<f32>(r, g, b, 1.0);

    let fade  = pow(uniforms.progress, 1.3);
    var color = mix(colorFrom, colorTo, fade);
    color     = color * (1.0 - baseDist * 0.65 * uniforms.progress);

    return color;
}
