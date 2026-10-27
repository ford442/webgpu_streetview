// Reproject (#331): the road frame's last stage before present.
//
// Reads the finished road frame (weather's output, or the upscale's, at the
// swap chain's size and format) and writes the swap chain — or, in WebXR, one
// eye's sub-image. Modes (ReprojectUniforms.mode, src/renderer/reproject/reprojectMath.ts):
//
//   0 copy     — textureLoad, texel for texel: a frame with nothing to latch is
//                bit-exact with the frame weather wrote.
//   1 latch    — re-aim the frame at the POV read at the end of the frame. A
//                rotation about the eye: an exact rectilinear re-projection,
//                no depth needed (rotation has no parallax).
//   2 sbs      — both eyes side by side (each squeezed to half width, 3D-TV
//                half-SBS), the latch applied first.
//   3 anaglyph — red from the left eye, green + blue from the right.
//   4 eye      — one eye (eyeSign) into the whole target (a WebXR view).
//
// An eye is synthesised from depth: the scene-depth map (#320, group 1, same
// SceneDepthParams struct as the weather passes) blended with the
// viewDepthProxy ground plane — with no map it is the proxy alone, so stereo
// works without the depth model. Each eye pixel searches the centre image
// along its row for the surface whose own parallax lands it here, nearest
// first; a disocclusion (no consistent surface) takes the farthest surface the
// search saw, nearest the occluder's edge, then a 3-tap blur. A gather never
// leaves a hole. Mirrored on the CPU by `stereoSourceX` for the tests.
//
// Its own uniform block (112 B) — never weather slots.

struct ReprojectUniforms {
    mode: f32,
    tanHalfH: f32,        // tan(hfov / 2) of one packed eye image
    tanHalfV: f32,
    halfIpd: f32,         // metres; 0 = mono
    convergenceInv: f32,  // 1 / zero-parallax distance (1/m)
    depthFar: f32,        // normalised depth 1 in metres
    horizonY: f32,        // screen Y of the horizon, for the proxy
    outputWidth: f32,
    outputHeight: f32,
    eyeSign: f32,         // -1 left, +1 right (mode 4)
    fillBlur: f32,        // 1 = blur the disocclusion fill
    pad0: f32,
    outFrustum: vec4<f32>,   // output ray tangents: centre x, centre y, half x, half y
    rotX: vec4<f32>,         // sourceFromOutput, column 0 (w unused)
    rotY: vec4<f32>,
    rotZ: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: ReprojectUniforms;

struct SceneDepthParams {
    blend        : f32,  // 0 = viewDepthProxy only (bit-exact), 1 = depth map only
    dolly        : f32,  // pass-1 release dolly along the view axis
    dollyLateral : f32,  // pass-1 release dolly across the view
    foeY         : f32,  // pass-1 dolly focus of expansion (screen Y)
    shiftX       : f32,  // screen UV -> depth-map UV shift, current POV
    shiftY       : f32,
    heldShiftX   : f32,  // the same shift for the hold snapshot's POV
    heldShiftY   : f32,
    zoom         : f32,  // digital zoom the depth map was inferred at
    pad0         : f32,  // pads the block to 48 bytes
    pad1         : f32,
    pad2         : f32,
}

@group(1) @binding(0) var sceneDepthTex: texture_2d<f32>;
@group(1) @binding(1) var sceneDepthSampler: sampler;
@group(1) @binding(2) var<uniform> depthParams: SceneDepthParams;

const DEPTH_NEAR_METRES: f32 = 1.2;
const STEREO_SEARCH_STEPS: i32 = 24;

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

// The packed-frame UV the output sees at `uv`: the output's ray (its own
// frustum — the packed one on a flat display, the eye's in WebXR) turned by
// sourceFromOutput (on a flat display Rx(-packedPitch) * Ry(yaw) * Rx(pitch))
// and projected into the packed camera. Identity (up to rounding — mode 0 is
// the exact path) when nothing moved.
fn latchSourceUV(uv: vec2<f32>) -> vec2<f32> {
    let e = vec2<f32>(
        u.outFrustum.x + (uv.x * 2.0 - 1.0) * u.outFrustum.z,
        u.outFrustum.y + (1.0 - uv.y * 2.0) * u.outFrustum.w,
    );
    let r = u.rotX.xyz * e.x + u.rotY.xyz * e.y + u.rotZ.xyz;
    let z = max(r.z, 1e-4);
    return vec2<f32>((r.x / z / u.tanHalfH + 1.0) * 0.5, (1.0 - r.y / z / u.tanHalfV) * 0.5);
}

fn viewDepthProxy(uv: vec2<f32>, horizonY: f32) -> f32 {
    let below = uv.y - horizonY;
    if (below <= 0.0) { return 1.0; }
    return clamp(0.06 / max(below, 0.0025), 0.0, 1.0);
}

// Normalised depth of the centre image at `uv`: the proxy, pulled toward the
// scene-depth map where there is one (the weather passes' sceneDepth()).
fn centreDepth(uv: vec2<f32>) -> f32 {
    let proxy = viewDepthProxy(uv, u.horizonY);
    if (depthParams.blend <= 0.0) { return proxy; }
    let duv = uv - vec2<f32>(depthParams.shiftX, depthParams.shiftY);
    let edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
    let coverage = smoothstep(0.0, 0.04, edge);
    let d = textureSampleLevel(sceneDepthTex, sceneDepthSampler, clamp(duv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    return mix(proxy, clamp(d, 0.0, 1.0), clamp(depthParams.blend, 0.0, 1.0) * coverage);
}

// How far (UV, + = right) a centre-image point at depth `d` moves in the eye.
fn eyeShift(d: f32, eyeSign: f32) -> f32 {
    let metres = max(min(d, 1.0) * u.depthFar, DEPTH_NEAR_METRES);
    var inv = 1.0 / metres;
    if (d >= 1.0) { inv = 0.0; }
    return -eyeSign * u.halfIpd * (inv - u.convergenceInv) / (2.0 * u.tanHalfH);
}

struct StereoSample {
    x: f32,
    consistent: bool,
};

// The centre-image X an eye pixel at (x, y) shows — see the header.
fn stereoSourceX(x: f32, y: f32, eyeSign: f32) -> StereoSample {
    let far = eyeShift(1.0, eyeSign);
    let near = eyeShift(DEPTH_NEAR_METRES / u.depthFar, eyeSign);
    let span = near - far;
    let tol = abs(span) / f32(STEREO_SEARCH_STEPS - 1);
    var fillX = x - far;
    var fillShift = 3.4e38;
    for (var i = 0; i < STEREO_SEARCH_STEPS; i = i + 1) {
        let s = near - span * f32(i) / f32(STEREO_SEARCH_STEPS - 1);
        let cx = x - s;
        let sc = eyeShift(centreDepth(vec2<f32>(cx, y)), eyeSign);
        if (abs(sc - s) <= tol) {
            return StereoSample(cx, true);
        }
        let farness = abs(sc - far);
        if (farness <= fillShift) {
            fillShift = farness;
            fillX = cx;
        }
    }
    return StereoSample(fillX, false);
}

// One eye at an eye-image UV: latch first (the eye looks where the head looks
// now), then the parallax search in the packed frame.
fn sampleEye(eyeUV: vec2<f32>, eyeSign: f32) -> vec4<f32> {
    let packed = latchSourceUV(eyeUV);
    let hit = stereoSourceX(packed.x, packed.y, eyeSign);
    let c = textureSampleLevel(src, srcSampler, vec2<f32>(hit.x, packed.y), 0.0);
    if (hit.consistent || u.fillBlur < 0.5) { return c; }
    // Soften the disocclusion fill across the row so the stretched background
    // does not read as a hard streak.
    let dx = 1.0 / max(u.outputWidth, 1.0);
    let l = textureSampleLevel(src, srcSampler, vec2<f32>(hit.x - 1.5 * dx, packed.y), 0.0);
    let r = textureSampleLevel(src, srcSampler, vec2<f32>(hit.x + 1.5 * dx, packed.y), 0.0);
    return (l + c * 2.0 + r) * 0.25;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let mode = i32(u.mode + 0.5);
    if (mode == 0) {
        return textureLoad(src, vec2<i32>(floor(in.position.xy)), 0);
    }
    if (mode == 1) {
        return textureSampleLevel(src, srcSampler, latchSourceUV(in.uv), 0.0);
    }
    if (mode == 2) {
        let right = in.uv.x >= 0.5;
        let eyeUV = vec2<f32>(fract(in.uv.x * 2.0), in.uv.y);
        return sampleEye(eyeUV, select(-1.0, 1.0, right));
    }
    if (mode == 3) {
        let l = sampleEye(in.uv, -1.0);
        let r = sampleEye(in.uv, 1.0);
        return vec4<f32>(l.r, r.g, r.b, 1.0);
    }
    return sampleEye(in.uv, u.eyeSign);
}
