enable f16;

// Toy `enable f16` spike — not in the production `validate:shaders` glob.
// naga-cli versions differ (22 rejected this file; 30 accepts it). Do not
// flip `shaderFeatureUses.shaderF16` or ship `f16` in weather / chores WGSL
// until a real production pass uses it. Feature stays requested-but-unused.
// See docs/RENDERER_FALLBACK.md § Capability matrix.

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    let x: f16 = 1.0h;
    return vec4<f32>(f32(x), f32(x), f32(x), 1.0);
}
