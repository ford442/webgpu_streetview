// transition-fade.wgsl
// Smooth cross-dissolve between two equirectangular panoramas.
//
// Outputs to rgba16float intermediate — weather-post.wgsl applies
// color grading and ACES tonemapping on top.
//
// Bind group layout:
//   @binding(0) uTextureFrom  — snapshot of the departing panorama
//   @binding(1) uTextureTo    — live Google Maps canvas (incoming)
//   @binding(2) uSampler      — linear filtering
//   @binding(3) uniforms      — TransitionUniforms (16 bytes)
//
// Recommended defaults: duration = 350ms

struct TransitionUniforms {
    progress : f32,   // 0.0 = fully from, 1.0 = fully to
    param1   : f32,   // unused for fade
    param2   : f32,   // unused for fade
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

// Full-screen triangle — more GPU cache-efficient than a 6-vertex quad.
// UV is passed through with Y-flip to match WebGPU texture coordinate conventions.
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
    let colorFrom = textureSample(uTextureFrom, uSampler, in.uv);
    let colorTo   = textureSample(uTextureTo,   uSampler, in.uv);

    // Cubic ease-in-out via smoothstep
    let t = smoothstep(0.0, 1.0, uniforms.progress);

    // Subtle brightness dip at midpoint — adds perceived smoothness
    // at max 12% darker when t = 0.5 (sin(π/2) = 1)
    let brightness = 1.0 - 0.12 * sin(t * 3.14159265);

    return mix(colorFrom, colorTo, t) * brightness;
}
