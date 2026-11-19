// transition-zoom.wgsl
// Zoom-forward + fade — gives the feeling of stepping into the next panorama.
//
// The outgoing panorama zooms in (magnifies) as progress increases, while
// the incoming panorama fades in at normal scale.  A subtle radial push is
// applied to the BASE UV before the zoom division so the distortion and zoom
// are independent transforms with no double-warp artefact.
//
// Bind group layout:
//   @binding(0) uTextureFrom  — snapshot of the departing panorama
//   @binding(1) uTextureTo    — live Google Maps canvas (incoming)
//   @binding(2) uSampler      — linear filtering
//   @binding(3) uniforms      — TransitionUniforms (16 bytes)
//
// Recommended defaults: duration = 450ms, param1 (zoomAmount) = 2.4

struct TransitionUniforms {
    progress : f32,
    param1   : f32,   // zoomAmount — how far to zoom in by progress=1 (e.g. 2.4)
    param2   : f32,   // unused
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

    // Radial push on base UV BEFORE zoom to avoid double-warp at high zoom values
    let push   = (in.uv - center) * baseDist * 0.15 * uniforms.progress;

    // Zoom the outgoing panorama toward the vanishing point
    let zoom   = 1.0 + (uniforms.param1 - 1.0) * uniforms.progress;
    let uvFrom = (in.uv + push - center) / zoom + center;

    let colorFrom = textureSample(uTextureFrom, uSampler, uvFrom);
    let colorTo   = textureSample(uTextureTo,   uSampler, in.uv);

    // Slightly accelerated fade — fast start, smooth landing
    let fade  = pow(uniforms.progress, 1.4);
    var color = mix(colorFrom, colorTo, fade);

    // Soft vignette focuses attention on the center during the zoom
    color = color * (1.0 - baseDist * 0.55 * uniforms.progress);

    return color;
}
