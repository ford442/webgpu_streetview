// Pass 3 — cabin over road, inside the same command encoder as the weather pass.
//
// The car interior renders into a GPUTexture (three `setOutputRenderTarget`,
// see src/car/interior/cabinFrameTarget.ts) instead of a second canvas the page
// composites in CSS. This draw puts that texture onto the swap chain the weather
// pass just wrote, so cinema clips and snapshots are one composited frame and
// `car/runtime/frameCapture.ts`'s 2D latch is not needed.
//
// The cabin target is cleared to transparent black and drawn with three's
// NormalBlending, so its texels are **premultiplied**. The pipeline's blend
// state is therefore premultiplied source-over (`one`, `one-minus-src-alpha`) —
// exactly what the browser did when it composited the two canvases — and this
// shader must not un-premultiply.
//
// Cabin and swap chain can differ in size (the cabin renders at whatever device
// pixel ratio the performance profile allows), so the UV comes from the
// fullscreen triangle rather than from either texture's dimensions, and the
// sampler filters the difference.

@group(0) @binding(0) var cabinTex: texture_2d<f32>;
@group(0) @binding(1) var cabinSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    // NDC is y-up, the render target is y-down — flip v, same convention the
    // road passes use when they divide `fragCoord` by the texture size.
    out.uv = vec2<f32>((pos.x + 1.0) * 0.5, (1.0 - pos.y) * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSampleLevel(cabinTex, cabinSampler, in.uv, 0.0);
}
