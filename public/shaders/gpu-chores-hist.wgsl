/**
 * gpu-chores histogram — BT.709 luma, 256 bins, 1/4-res samples, workgroup (8,8).
 * Matches src/renderer/gpuChores/lumaMath.ts / WASM `luma_histogram_bt709`.
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
fn luma_histogram_bt709(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(srcTex);
    let px = gid.xy * 2u;
    if (px.x >= dims.x || px.y >= dims.y) {
        return;
    }
    let rgb = textureLoad(srcTex, vec2<i32>(px), 0).rgb;
    atomicAdd(&bins[bt709_bin(rgb)], 1u);
}
