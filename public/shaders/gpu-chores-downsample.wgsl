/**
 * gpu-chores downsample_2d — integer box filter, workgroup (8,8).
 * Matches src/renderer/gpuChores/lumaMath.ts / WASM `downsample_2d`.
 */

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var dstTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> size: vec4<u32>; // xy = src, zw = dst

@compute @workgroup_size(8, 8, 1)
fn downsample_2d(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dstW = size.z;
    let dstH = size.w;
    let srcW = size.x;
    let srcH = size.y;
    if (gid.x >= dstW || gid.y >= dstH || srcW == 0u || srcH == 0u) {
        return;
    }
    var x0 = (gid.x * srcW) / dstW;
    var x1 = ((gid.x + 1u) * srcW) / dstW;
    var y0 = (gid.y * srcH) / dstH;
    var y1 = ((gid.y + 1u) * srcH) / dstH;
    if (x1 <= x0) { x1 = x0 + 1u; }
    if (y1 <= y0) { y1 = y0 + 1u; }
    if (x1 > srcW) { x1 = srcW; }
    if (y1 > srcH) { y1 = srcH; }

    var acc = vec4<f32>(0.0);
    var n = 0.0;
    var y = y0;
    loop {
        if (y >= y1) { break; }
        var x = x0;
        loop {
            if (x >= x1) { break; }
            acc += textureLoad(srcTex, vec2<i32>(i32(x), i32(y)), 0);
            n += 1.0;
            x += 1u;
        }
        y += 1u;
    }
    let out = select(vec4<f32>(0.0, 0.0, 0.0, 1.0), acc / n, n > 0.0);
    textureStore(dstTex, vec2<i32>(gid.xy), out);
}
