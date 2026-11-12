// Motion field (#360 slice 1): where each intermediate pixel was last frame.
//
// Writes rg16float at the intermediate's size: motion = current - previous,
// in intermediate pixels (+x right, +y down). The history of pixel p is at
// p - motion. Mirrored on the CPU by src/renderer/temporal/motionMath.ts —
// change both together (motionMath.test.ts pins the layout and the maths).
//
//   mode 0 none   — no previous frame of this view (first frame, resize,
//                   hold, pano change, Maps zoom step, cut): zero.
//   mode 1 camera — the camera's rotation since last frame as an exact
//                   homography (a pano only rotates; a zoom change is the FOV
//                   term), after the release dolly's progress since last frame
//                   (streetview.wgsl samplePrevForRelease, first order). With
//                   dolly = dollyLateral = 0 the dolly term is the identity.
//
// Its own uniform block (112 B) — never weather slots. Group 1 is the shared
// scene-depth group (depth/sceneDepthBinding.ts); the renderer binds its
// all-zero fallback when there is no depth, which zeroes the dolly.

struct MotionUniforms {
    mode: f32,
    prevTanHalfH: f32,    // tan(hfov / 2) of the previous frame's camera
    prevTanHalfV: f32,
    width: f32,           // intermediate size, pixels
    height: f32,
    zoom: f32,            // this frame's digital zoom (pass 1 uniforms.zoom)
    progress: f32,        // release progress t, this frame
    prevProgress: f32,    // release progress t, last frame
    look: vec2<f32>,      // hold look-around shift, canvas UV
    pad0: vec2<f32>,
    outFrustum: vec4<f32>,   // current ray tangents: centre x, centre y, half x, half y
    rotX: vec4<f32>,         // prevFromCurrent, column 0 (w unused)
    rotY: vec4<f32>,
    rotZ: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: MotionUniforms;

struct SceneDepthParams {
    blend        : f32,
    dolly        : f32,  // pass-1 release dolly along the view axis
    dollyLateral : f32,  // pass-1 release dolly across the view
    foeY         : f32,  // pass-1 dolly focus of expansion (screen Y)
    shiftX       : f32,
    shiftY       : f32,
    heldShiftX   : f32,  // depth-map UV shift for the hold snapshot's POV
    heldShiftY   : f32,
    zoom         : f32,  // digital zoom the depth map was inferred at
    pad0         : f32,  // pads the block to 48 bytes
    pad1         : f32,
    pad2         : f32,
}

@group(1) @binding(0) var sceneDepthTex: texture_2d<f32>;
@group(1) @binding(1) var sceneDepthSampler: sampler;
@group(1) @binding(2) var<uniform> depthParams: SceneDepthParams;

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

// The UV the previous frame showed the world ray this frame shows at `uv`.
fn cameraPrevUV(uv: vec2<f32>) -> vec2<f32> {
    let e = vec2<f32>(
        u.outFrustum.x + (uv.x * 2.0 - 1.0) * u.outFrustum.z,
        u.outFrustum.y + (1.0 - uv.y * 2.0) * u.outFrustum.w,
    );
    let r = u.rotX.xyz * e.x + u.rotY.xyz * e.y + u.rotZ.xyz;
    let z = max(r.z, 1e-4);
    return vec2<f32>((r.x / z / u.prevTanHalfH + 1.0) * 0.5, (1.0 - r.y / z / u.prevTanHalfV) * 0.5);
}

// streetview.wgsl heldNearness, with the look-around shift from MotionUniforms.
fn heldNearness(uv: vec2<f32>) -> f32 {
    let prevUV = uv - u.look;
    let screen = (prevUV - vec2<f32>(0.5)) * depthParams.zoom + vec2<f32>(0.5);
    let duv = screen - vec2<f32>(depthParams.heldShiftX, depthParams.heldShiftY);
    let edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
    let coverage = smoothstep(0.0, 0.04, edge);
    let d = textureSampleLevel(sceneDepthTex, sceneDepthSampler, clamp(duv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    return (1.0 - clamp(d, 0.0, 1.0)) * coverage;
}

// Where, in screen UV, the held frame showed last frame what it shows at
// `screenUV` now. Identity with no dolly — samplePrevForRelease's early return.
fn dollyPrevUV(screenUV: vec2<f32>) -> vec2<f32> {
    if (depthParams.dolly == 0.0 && depthParams.dollyLateral == 0.0) {
        return screenUV;
    }
    let uv = (screenUV - vec2<f32>(0.5)) / u.zoom + vec2<f32>(0.5);
    let near = heldNearness(uv);
    let foe = vec2<f32>(0.5, depthParams.foeY);
    let t = u.progress;
    let t0 = u.prevProgress;
    // This frame: the snapshot point the pixel shows.
    let scale = max(1.0 + depthParams.dolly * t * near, 0.5);
    var src = foe + (screenUV - foe) / scale;
    src.x = src.x + depthParams.dollyLateral * t * near;
    // Last frame: where that snapshot point was drawn.
    let scale0 = max(1.0 + depthParams.dolly * t0 * near, 0.5);
    var q = src;
    q.x = q.x - depthParams.dollyLateral * t0 * near;
    return foe + (q - foe) * scale0;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (u.mode < 0.5) {
        return vec4<f32>(0.0);
    }
    let prev = cameraPrevUV(dollyPrevUV(input.uv));
    let motion = (input.uv - prev) * vec2<f32>(u.width, u.height);
    return vec4<f32>(motion, 0.0, 0.0);
}
