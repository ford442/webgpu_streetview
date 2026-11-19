// Scene depth (src/renderer/depth/sceneDepthBinding.ts): a monocular depth map
// on the viewDepthProxy scale (0 = at the camera, 1 = horizon or beyond) and
// the weight that blends it in. Without depth the renderer binds a 1x1 texture
// and an all-zero block, so blend is 0 and every reader returns the proxy
// bit-exactly (every reader's early return / verbatim branch).
//
// The one definition of the block, its bindings and its readers for every pass
// that binds it: the weather post-process (both paths) at group 2, pass 1,
// motion and reproject at group 1 — the `scene_depth_group1` condition, fixed
// per entry in shaders.manifest.json. The layout is SCENE_DEPTH_PARAM_FLOATS in
// sceneDepthBinding.ts.
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

// Normalized view distance: 0 = right in front of the camera, 1 = horizon or
// beyond. Hyperbolic falloff below the horizon approximates eyeHeight/tan(angle).
fn viewDepthProxy(uv: vec2<f32>, horizonY: f32) -> f32 {
    let below = uv.y - horizonY;
    if (below <= 0.0) { return 1.0; }
    return clamp(0.06 / max(below, 0.0025), 0.0, 1.0);
}

@if(scene_depth_group1) @group(1) @binding(0) var sceneDepthTex: texture_2d<f32>;
@else @group(2) @binding(0) var sceneDepthTex: texture_2d<f32>;
@if(scene_depth_group1) @group(1) @binding(1) var sceneDepthSampler: sampler;
@else @group(2) @binding(1) var sceneDepthSampler: sampler;
@if(scene_depth_group1) @group(1) @binding(2) var<uniform> depthParams: SceneDepthParams;
@else @group(2) @binding(2) var<uniform> depthParams: SceneDepthParams;

// Depth-map sample at a screen UV: (depth, coverage). The map was inferred at
// an earlier POV; `shift` is the look-around since then (the hold-pause
// look-around mapping, in screen units), and coverage fades to 0 where the
// shifted UV leaves the map, so off-map pixels fall back to the proxy instead
// of smearing an edge texel.
fn sampleSceneDepthMap(screenUV: vec2<f32>, shift: vec2<f32>) -> vec2<f32> {
    let duv = screenUV - shift;
    let edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
    let coverage = smoothstep(0.0, 0.04, edge);
    let d = textureSampleLevel(sceneDepthTex, sceneDepthSampler, clamp(duv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    return vec2<f32>(clamp(d, 0.0, 1.0), coverage);
}

// The depth every effect reads: viewDepthProxy, pulled toward the monocular
// scene-depth map by depthParams.blend. blend 0 (no depth, Low and Medium
// quality, scene depth off) takes the early return and is the proxy
// bit-exactly. Weather passes the shared horizon; reproject its own.
fn sceneDepth(uv: vec2<f32>, horizonY: f32) -> f32 {
    let proxy = viewDepthProxy(uv, horizonY);
    if (depthParams.blend <= 0.0) { return proxy; }
    let m = sampleSceneDepthMap(uv, vec2<f32>(depthParams.shiftX, depthParams.shiftY));
    return mix(proxy, m.x, clamp(depthParams.blend, 0.0, 1.0) * m.y);
}

// How near the held (hold-pause snapshot) frame is at the snapshot UV the
// look-around samples: 1 = at the camera, 0 = skyline or off the depth map.
// Maps that UV to the depth map's screen space — the digital zoom it was
// inferred at, then the POV shift between inference and capture. Pass 1's
// release dolly and the motion field's dolly term both read it.
fn heldDepthNearness(prevUV: vec2<f32>) -> f32 {
    let screen = (prevUV - vec2<f32>(0.5)) * depthParams.zoom + vec2<f32>(0.5);
    let m = sampleSceneDepthMap(screen, vec2<f32>(depthParams.heldShiftX, depthParams.heldShiftY));
    return (1.0 - m.x) * m.y;
}
