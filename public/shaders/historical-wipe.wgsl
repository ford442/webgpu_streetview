// Historical time machine — year-chip wipe.
//
// Drawn over pass 1 (loadOp 'load') into the HDR intermediate while a
// year-chip hop releases: pass 1 has already drawn the new ("after") panorama,
// and this pass paints the frozen "before" frame — the hold-pause snapshot
// (`TransitionManager.previousFrame`) — over the side the edge has not yet
// swept. It never samples the live upload texture.
//
// Own 4-float uniform; the 44-float weather block is untouched.
// Mirror: `isRevealedAt` in src/renderer/historicalWipe.ts.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct WipeUniforms {
    progress: f32,   // 0 = all before, 1 = all after
    direction: f32,  // +1 sweeps in from the left, -1 from the right
    pad0: f32,
    pad1: f32,
};

@group(0) @binding(0) var wipeSampler: sampler;
@group(0) @binding(1) var beforeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> wipe: WipeUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32((vertexIndex & 1u) * 2u) - 1.0;
    let y = f32((vertexIndex & 2u)) - 1.0;
    output.pos = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample before the discard so textureSample stays in uniform control flow.
    let before = textureSample(beforeTexture, wipeSampler, clamp(input.uv, vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
    let along = select(input.uv.x, 1.0 - input.uv.x, wipe.direction < 0.0);
    if (along < wipe.progress) {
        discard;
    }
    // A thin shadow on the held side of the edge so the seam reads as a sheet
    // being pulled away, not a hard splice.
    let edgeGap = along - wipe.progress;
    let shade = mix(0.65, 1.0, smoothstep(0.0, 0.02, edgeGap));
    return vec4<f32>(before * shade, 1.0);
}
