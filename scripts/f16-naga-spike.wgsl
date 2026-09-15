enable f16;

// Naga spike for production `shader-f16`. CI `naga-cli` rejects this file
// (`npm run validate:shaders -- --expect-fail=scripts/f16-naga-spike.wgsl`).
// Do not ship `f16` in weather / chores WGSL until naga accepts it — the
// feature stays on requestDevice as requested-but-unused.
// See docs/RENDERER_FALLBACK.md § Capability matrix.

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    let x: f16 = 1.0h;
    return vec4<f32>(f32(x), f32(x), f32(x), 1.0);
}
