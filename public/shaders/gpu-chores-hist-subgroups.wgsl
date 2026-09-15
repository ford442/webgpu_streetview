enable subgroups;

/**
 * gpu-chores histogram — subgroup-coalesced atomics.
 * Same BT.709 256-bin, 1/4-res samples, workgroup (8,8) as gpu-chores-hist.wgsl.
 * Loaded only when `subgroups` is enabled on the shared GPUDevice; the scalar
 * atomicAdd path stays the naga-validated default (`?gpu=compat` included).
 */

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 256>;

const BT709: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

fn bt709_bin(rgb: vec3<f32>) -> u32 {
    let u = rgb * 255.0;
    let acc = dot(u, BT709);
    return u32(clamp(floor(acc + 0.5), 0.0, 255.0));
}

@compute @workgroup_size(8, 8, 1)
fn luma_histogram_bt709(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(subgroup_invocation_id) sgid: u32,
    @builtin(subgroup_size) sgsize: u32,
) {
    let dims = textureDimensions(srcTex);
    let px = gid.xy * 2u;
    let valid = px.x < dims.x && px.y < dims.y;
    var bin = 0u;
    if (valid) {
        let rgb = textureLoad(srcTex, vec2<i32>(px), 0).rgb;
        bin = bt709_bin(rgb);
    }

    // Uniform shuffle loop — do not early-return; invalid lanes contribute 0.
    var count = 0u;
    var is_leader = valid;
    var i = 0u;
    loop {
        if (i >= sgsize) { break; }
        let other_valid = subgroupShuffle(select(0u, 1u, valid), i) == 1u;
        let other_bin = subgroupShuffle(bin, i);
        if (valid && other_valid && other_bin == bin) {
            count += 1u;
            if (i < sgid) {
                is_leader = false;
            }
        }
        i += 1u;
    }
    if (is_leader && count > 0u) {
        atomicAdd(&bins[bin], count);
    }
}
