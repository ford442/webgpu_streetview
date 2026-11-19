// Render-scale upscale (#329): the scaled road frame → the swap chain.
//
// Runs only when the road renders below scale 1 (src/renderer/renderScale.ts):
// the weather pass has written a `presentationFormat` road target at
// `canvas × scale`, and this brings it to the canvas size. Two routes:
//
// - FSR 1.0 (default): `fs_easu` (Edge Adaptive Spatial Upsampling) into an
//   rgba16float texture at output size, then `fs_rcas` (Robust Contrast
//   Adaptive Sharpening) into the swap chain. A port of AMD FidelityFX Super
//   Resolution 1.0's `FsrEasuF` / `FsrRcasF` (ffx_fsr1.h, MIT licence,
//   Copyright (c) 2021 Advanced Micro Devices, Inc.) — the 12-tap kernel uses
//   `textureLoad` instead of four gathers, and the approximate reciprocals are
//   exact ones with a floor, but the math is FSR's. Input is the weather pass's
//   display-referred output, which is the space FSR 1.0 expects.
// - `fs_bilinear` (`?upscale=bilinear`): a plain filtered stretch.
//
// Its own uniform block (`UpscaleUniforms`, 32 B, src/renderer/upscale/UpscalePass.ts)
// — never weather slots.

struct UpscaleUniforms {
    inputSize: vec2<f32>,   // scaled road frame, px
    outputSize: vec2<f32>,  // swap chain, px
    sharpness: f32,         // RCAS con.x = exp2(-stops); 1 is the sharpest
    peak: f32,              // RCAS limiter ceiling: 1 on SDR, the extended headroom on ?hdr
    pad0: f32,
    pad1: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: UpscaleUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    let p = corners[vertexIndex];
    var out: VertexOutput;
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
}

fn loadClamped(p: vec2<i32>) -> vec3<f32> {
    let last = vec2<i32>(textureDimensions(src)) - vec2<i32>(1, 1);
    return textureLoad(src, clamp(p, vec2<i32>(0, 0), last), 0).rgb;
}

// FSR's "luma times 2, in 2 FMA": b/2 + (r/2 + g).
fn lumaX2(c: vec3<f32>) -> f32 {
    return c.b * 0.5 + (c.r * 0.5 + c.g);
}

// FSR uses an approximate reciprocal that stays finite at 0; this is exact with a floor.
fn rcpFloor(x: f32) -> f32 {
    return 1.0 / max(x, 1.0 / 65536.0);
}

// ---------------------------------------------------------------------------
// EASU
// ---------------------------------------------------------------------------

struct EasuDirection {
    dir: vec2<f32>,
    len: f32,
};

// FsrEasuSetF: one bilinear quad's '+' gradient, weighted by `w`.
//     a
//   b c d
//     e
fn easuSet(acc: ptr<function, EasuDirection>, w: f32, lA: f32, lB: f32, lC: f32, lD: f32, lE: f32) {
    let dirX = lD - lB;
    var lenX = saturate(abs(dirX) * rcpFloor(max(abs(lD - lC), abs(lC - lB))));
    lenX = lenX * lenX;
    let dirY = lE - lA;
    var lenY = saturate(abs(dirY) * rcpFloor(max(abs(lE - lC), abs(lC - lA))));
    lenY = lenY * lenY;
    (*acc).dir = (*acc).dir + vec2<f32>(dirX, dirY) * w;
    (*acc).len = (*acc).len + (lenX + lenY) * w;
}

// FsrEasuTapF: one tap of the rotated, stretched lanczos-2 approximation.
fn easuTap(
    aC: ptr<function, vec3<f32>>,
    aW: ptr<function, f32>,
    off: vec2<f32>,
    dir: vec2<f32>,
    len: vec2<f32>,
    lob: f32,
    clp: f32,
    c: vec3<f32>,
) {
    var v = vec2<f32>(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
    v = v * len;
    let d2 = min(dot(v, v), clp);
    // (25/16 * (2/5 * x^2 - 1)^2 - (25/16 - 1)) * (lob * x^2 - 1)^2
    var wB = 0.4 * d2 - 1.0;
    var wA = lob * d2 - 1.0;
    wB = wB * wB;
    wA = wA * wA;
    wB = 1.5625 * wB - 0.5625;
    let w = wB * wA;
    *aC = *aC + c * w;
    *aW = *aW + w;
}

@fragment
fn fs_easu(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    // Output pixel centre in input texel space; `f` is the texel up-left of it.
    var pp = fragCoord.xy * (u.inputSize / u.outputSize) - vec2<f32>(0.5, 0.5);
    let fp = floor(pp);
    pp = pp - fp;
    let ip = vec2<i32>(fp);

    // 12-tap kernel.
    //    b c
    //  e f g h
    //  i j k l
    //    n o
    let b = loadClamped(ip + vec2<i32>(0, -1));
    let c = loadClamped(ip + vec2<i32>(1, -1));
    let e = loadClamped(ip + vec2<i32>(-1, 0));
    let f = loadClamped(ip);
    let g = loadClamped(ip + vec2<i32>(1, 0));
    let h = loadClamped(ip + vec2<i32>(2, 0));
    let i = loadClamped(ip + vec2<i32>(-1, 1));
    let j = loadClamped(ip + vec2<i32>(0, 1));
    let k = loadClamped(ip + vec2<i32>(1, 1));
    let l = loadClamped(ip + vec2<i32>(2, 1));
    let n = loadClamped(ip + vec2<i32>(0, 2));
    let o = loadClamped(ip + vec2<i32>(1, 2));

    let bL = lumaX2(b);
    let cL = lumaX2(c);
    let eL = lumaX2(e);
    let fL = lumaX2(f);
    let gL = lumaX2(g);
    let hL = lumaX2(h);
    let iL = lumaX2(i);
    let jL = lumaX2(j);
    let kL = lumaX2(k);
    let lL = lumaX2(l);
    let nL = lumaX2(n);
    let oL = lumaX2(o);

    // Direction and edge length, bilinearly accumulated from the four quads.
    var acc = EasuDirection(vec2<f32>(0.0, 0.0), 0.0);
    easuSet(&acc, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    easuSet(&acc, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    easuSet(&acc, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    easuSet(&acc, pp.x * pp.y, gL, jL, kL, lL, oL);

    // Normalize, and clean up close to zero.
    var dir = acc.dir;
    let dirR2 = dot(dir, dir);
    let zro = dirR2 < 1.0 / 32768.0;
    let dirR = select(inverseSqrt(max(dirR2, 1.0 / 32768.0)), 1.0, zro);
    dir = vec2<f32>(select(dir.x, 1.0, zro), dir.y) * dirR;

    // {0 to 2} → {0 to 1}, shaped with a square.
    var len = acc.len * 0.5;
    len = len * len;
    // Stretch the kernel: 1 vertical/horizontal, sqrt(2) on the diagonal.
    let stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    let len2 = vec2<f32>(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    // The window shifts from ±sqrt(2) to slightly beyond 2 with the amount of edge.
    let lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    let clp = 1.0 / lob;

    var aC = vec3<f32>(0.0, 0.0, 0.0);
    var aW = 0.0;
    easuTap(&aC, &aW, vec2<f32>(0.0, -1.0) - pp, dir, len2, lob, clp, b);
    easuTap(&aC, &aW, vec2<f32>(1.0, -1.0) - pp, dir, len2, lob, clp, c);
    easuTap(&aC, &aW, vec2<f32>(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
    easuTap(&aC, &aW, vec2<f32>(0.0, 1.0) - pp, dir, len2, lob, clp, j);
    easuTap(&aC, &aW, vec2<f32>(0.0, 0.0) - pp, dir, len2, lob, clp, f);
    easuTap(&aC, &aW, vec2<f32>(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
    easuTap(&aC, &aW, vec2<f32>(1.0, 1.0) - pp, dir, len2, lob, clp, k);
    easuTap(&aC, &aW, vec2<f32>(2.0, 1.0) - pp, dir, len2, lob, clp, l);
    easuTap(&aC, &aW, vec2<f32>(2.0, 0.0) - pp, dir, len2, lob, clp, h);
    easuTap(&aC, &aW, vec2<f32>(1.0, 0.0) - pp, dir, len2, lob, clp, g);
    easuTap(&aC, &aW, vec2<f32>(1.0, 2.0) - pp, dir, len2, lob, clp, o);
    easuTap(&aC, &aW, vec2<f32>(0.0, 2.0) - pp, dir, len2, lob, clp, n);

    // Normalize, and dering against the four nearest texels.
    let mn = min(min(f, g), min(j, k));
    let mx = max(max(f, g), max(j, k));
    let filtered = select(f, aC / aW, aW > 1.0e-5);
    return vec4<f32>(min(mx, max(mn, filtered)), 1.0);
}

// ---------------------------------------------------------------------------
// RCAS
// ---------------------------------------------------------------------------

// FSR_RCAS_LIMIT: the strongest negative lobe RCAS will use.
const RCAS_LIMIT: f32 = 0.25 - 1.0 / 16.0;

@fragment
fn fs_rcas(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    // Minimal 3×3 neighbourhood:
    //    b
    //  d e f
    //    h
    let sp = vec2<i32>(fragCoord.xy);
    let b = loadClamped(sp + vec2<i32>(0, -1));
    let d = loadClamped(sp + vec2<i32>(-1, 0));
    let e = loadClamped(sp);
    let f = loadClamped(sp + vec2<i32>(1, 0));
    let h = loadClamped(sp + vec2<i32>(0, 1));

    let mn4 = min(min(b, d), min(f, h));
    let mx4 = max(max(b, d), max(f, h));
    // FSR's peakC = (1, -4), scaled by the output's peak.
    let peakC = vec2<f32>(u.peak, -4.0 * u.peak);
    let hitMin = min(mn4, e) / max(4.0 * mx4, vec3<f32>(1.0 / 65536.0));
    let hitMax = (vec3<f32>(peakC.x) - max(mx4, e)) / min(4.0 * mn4 + vec3<f32>(peakC.y), vec3<f32>(-1.0 / 65536.0));
    let lobeRGB = max(-hitMin, hitMax);
    let lobe = max(-RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * u.sharpness;

    let rgb = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
    return vec4<f32>(rgb, 1.0);
}

// ---------------------------------------------------------------------------
// Bilinear
// ---------------------------------------------------------------------------

@fragment
fn fs_bilinear(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(textureSampleLevel(src, srcSampler, in.uv, 0.0).rgb, 1.0);
}
