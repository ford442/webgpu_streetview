// Streetview shader - panoramic image viewer
// Outputs to HDR intermediate texture for post-processing
// Note: Color grading and weather effects are applied in weather-post.wgsl
//
// Transition support:
// - holdActive: freeze on previousFrameTexture while the next panorama loads
// - Look-around: UV shift on the frozen frame from heading/pitch delta
// - Release: crossfade when transitionProgress goes 0→1. With a scene-depth map
//   for the held frame (group 1, src/renderer/depth/sceneDepthBinding.ts) the
//   outgoing frame also dollies — near pixels move more than the skyline. With
//   dolly 0 (no depth, a teleport, reduced motion) it is the plain crossfade.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct PanoramaUniforms {
    time: f32,
    zoom: f32,
    panX: f32,              // current normalized heading (0–1)
    panY: f32,              // current normalized pitch  (0–1)
    transitionProgress: f32,
    holdActive: f32,        // 1.0 = freeze on previous frame
    capturePanX: f32,       // panX at snapshot capture time
    capturePanY: f32,       // panY at snapshot capture time
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32((vertexIndex & 1u) * 2u) - 1.0;
    let y = f32((vertexIndex & 2u)) - 1.0;
    output.pos = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return output;
}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: PanoramaUniforms;
@group(0) @binding(3) var previousFrameTexture: texture_2d<f32>;

// Scene depth — same struct as the weather passes; pass 1 reads only the dolly
// fields. The renderer binds an all-zero block when there is no depth.
struct SceneDepthParams {
    blend        : f32,
    dolly        : f32,  // > 0 push in (forward hop), < 0 pull back
    dollyLateral : f32,  // side-step: near pixels slide the most
    foeY         : f32,  // focus of expansion, screen Y (the horizon at capture)
    shiftX       : f32,
    shiftY       : f32,
    heldShiftX   : f32,  // depth-map UV shift for the hold snapshot's POV
    heldShiftY   : f32,
    zoom         : f32,  // digital zoom the depth map was inferred at
    pad0         : f32,
    pad1         : f32,
    pad2         : f32,
}

@group(1) @binding(0) var sceneDepthTex: texture_2d<f32>;
@group(1) @binding(1) var sceneDepthSampler: sampler;
@group(1) @binding(2) var<uniform> depthParams: SceneDepthParams;

// Wrap heading delta across the 0/1 seam (e.g. 350° → 10° = +20°, not -340°)
fn wrapDelta(a: f32, b: f32) -> f32 {
    var d = a - b;
    if (d > 0.5) { d -= 1.0; }
    if (d < -0.5) { d += 1.0; }
    return d;
}

fn samplePrevWithLookAround(baseUV: vec2<f32>) -> vec3<f32> {
    let lookScaleH = 4.0 / uniforms.zoom;
    let lookScaleV = 2.8 / uniforms.zoom;
    let deltaX = wrapDelta(uniforms.panX, uniforms.capturePanX) * lookScaleH;
    let deltaY = (uniforms.panY - uniforms.capturePanY) * lookScaleV;
    let prevUV = clamp(baseUV - vec2<f32>(deltaX, deltaY), vec2<f32>(0.0), vec2<f32>(1.0));
    return textureSample(previousFrameTexture, texSampler, prevUV).rgb;
}

// How near the held frame is at a (zoomed) canvas UV: 1 = at the camera,
// 0 = skyline or off the depth map. Maps the snapshot UV the look-around
// samples to the depth map's screen space (zoom, then the POV shift between
// inference and capture).
fn heldNearness(baseUV: vec2<f32>) -> f32 {
    let lookScaleH = 4.0 / uniforms.zoom;
    let lookScaleV = 2.8 / uniforms.zoom;
    let deltaX = wrapDelta(uniforms.panX, uniforms.capturePanX) * lookScaleH;
    let deltaY = (uniforms.panY - uniforms.capturePanY) * lookScaleV;
    let prevUV = baseUV - vec2<f32>(deltaX, deltaY);
    let screen = (prevUV - vec2<f32>(0.5)) * depthParams.zoom + vec2<f32>(0.5);
    let duv = screen - vec2<f32>(depthParams.heldShiftX, depthParams.heldShiftY);
    let edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
    let coverage = smoothstep(0.0, 0.04, edge);
    let d = textureSampleLevel(sceneDepthTex, sceneDepthSampler, clamp(duv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    return (1.0 - clamp(d, 0.0, 1.0)) * coverage;
}

// The held frame during the release. dolly 0 and dollyLateral 0 return
// samplePrevWithLookAround(uv) exactly. Otherwise each pixel reads the snapshot
// as if the camera had moved by `t` of a hop: along the view axis the image
// expands from the focus of expansion by 1 + dolly·t·nearness, across it near
// pixels slide against the motion — parallax from the depth map, where the
// pre-depth release was a flat crossfade.
fn samplePrevForRelease(screenUV: vec2<f32>, uv: vec2<f32>, t: f32) -> vec3<f32> {
    if (depthParams.dolly == 0.0 && depthParams.dollyLateral == 0.0) {
        return samplePrevWithLookAround(uv);
    }
    let near = heldNearness(uv);
    let foe = vec2<f32>(0.5, depthParams.foeY);
    let scale = max(1.0 + depthParams.dolly * t * near, 0.5);
    var src = foe + (screenUV - foe) / scale;
    src.x = src.x + depthParams.dollyLateral * t * near;
    let srcUV = (src - vec2<f32>(0.5)) / uniforms.zoom + vec2<f32>(0.5);
    return samplePrevWithLookAround(srcUV);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let zoom = uniforms.zoom;
    let center = vec2<f32>(0.5, 0.5);

    // Apply digital zoom centered on the image
    var uv = (input.uv - center) / zoom + center;
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

    let t = uniforms.transitionProgress;
    let holding = uniforms.holdActive > 0.5;

    var color: vec3<f32>;
    if (holding) {
        // Pause: only sample the GPU snapshot — never touch the live tex binding
        color = samplePrevWithLookAround(uv);
    } else {
        // Live feed — Google Maps renders at the current heading/pitch, no UV shift needed
        color = textureSample(tex, texSampler, clampedUV).rgb;
        if (t > 0.0 && t < 1.0) {
            // Release: clean crossfade from held frame to the new live panorama
            let prevColor = samplePrevForRelease(input.uv, uv, t);
            let fade = pow(t, 1.2);
            color = mix(prevColor, color, fade);
        }
    }

    return vec4<f32>(color, 1.0);
}
