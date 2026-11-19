import package::lib::noise::{hash, noise2D};
import package::lib::sceneDepth::sceneDepth;
import package::weather::bindings::{linearSampler, p_rainIntensity, p_snowIntensity, sceneTex};
import package::weather::horizon::sceneHorizonY;

// Semantic scene layer (group 3, src/renderer/semantic/sceneSemanticBinding.ts,
// #352): an rg8unorm class map of the road frame — R = class id + 1 (0 =
// unlabelled), G = that class's probability — and per-effect weights. Without
// a map the renderer binds a 1x1 unlabelled texel and an all-zero block, so
// semParams.blend is 0 and every semantic helper returns its input unchanged
// (bit-exact). Shared by both weather paths; the class ids match
// src/renderer/semantic/semanticClasses.ts.
struct SceneSemanticParams {
    blend      : f32,  // preset weight x trust in the map; 0 = pre-semantic (bit-exact)
    shiftX     : f32,  // screen UV -> class-map UV shift, current POV
    shiftY     : f32,
    rainSky    : f32,  // rain streaks thinned over sky pixels
    wetRoad    : f32,  // wet sheen on road pixels only
    snowCover  : f32,  // settled snow on horizontal classes
    fogSky     : f32,  // fog coverage relaxed over the sky
    relight    : f32,  // per-class night relight
    skyReplace : f32,  // analytic sky behind the sky matte
    zoom       : f32,  // digital zoom the map was inferred at
    stillness  : f32,  // 1 under reduced motion: static clouds, steady windows
    skyR       : f32,  // the photo's mean sky colour when the map was made
    skyG       : f32,  //   (sky regrade reference and sky key colour; all 0 = no sky)
    skyB       : f32,
    pad0       : f32,  // pads the block to 64 bytes
    pad1       : f32,
}

@group(3) @binding(0) var semanticTex: texture_2d<f32>;

@group(3) @binding(1) var semanticSampler: sampler;

@group(3) @binding(2) var<uniform> semParams: SceneSemanticParams;

const CLASS_SKY: i32 = 0;

const CLASS_ROAD: i32 = 1;

const CLASS_SIDEWALK: i32 = 2;

const CLASS_BUILDING: i32 = 3;

const CLASS_VEGETATION: i32 = 4;

const CLASS_VEHICLE: i32 = 5;

const CLASS_PERSON: i32 = 6;

// ============================================================================
// MAIN FRAGMENT SHADER
// ============================================================================
// SEMANTIC SCENE LAYER (#352) — class lookups and the effects that use them
// ============================================================================
// Every helper here takes its pre-semantic branch while semParams.blend is 0
// (no map, the layer off, Low/Medium quality): it returns its input exactly.

// Class-map UV for a screen UV (minus the look-around since inference) and
// how much of the map covers it, as (u, v, coverage). Coverage fades to 0
// where the shifted UV leaves the map, like sampleSceneDepthMap.
fn semanticMapUv(uv: vec2<f32>) -> vec3<f32> {
    let muv = uv - vec2<f32>(semParams.shiftX, semParams.shiftY);
    let edge = min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y));
    return vec3<f32>(clamp(muv, vec2<f32>(0.0), vec2<f32>(1.0)), smoothstep(0.0, 0.04, edge));
}

// Class id (-1 = unlabelled) and probability at one map texel (clamped to the map).
fn semanticTexel(texel: vec2<i32>) -> vec2<f32> {
    let dims = vec2<i32>(textureDimensions(semanticTex));
    let s = textureLoad(semanticTex, clamp(texel, vec2<i32>(0), dims - vec2<i32>(1)), 0);
    return vec2<f32>(round(s.r * 255.0) - 1.0, s.g);
}

// The class at a screen UV: (id, probability, coverage); id -1 = unlabelled.
fn sceneClass(uv: vec2<f32>) -> vec3<f32> {
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let c = semanticTexel(vec2<i32>(floor(m.xy * dims)));
    return vec3<f32>(c.x, c.y, m.z);
}

// Weight of one class at a screen UV, 0-1: the class indicator interpolated
// between the four nearest map texels (a one-texel feather, ~5 px at 1080p —
// class ids themselves are never filtered), times map coverage and
// semParams.blend. 0 without a map.
fn classWeight(uv: vec2<f32>, cls: i32) -> f32 {
    if (semParams.blend <= 0.0) { return 0.0; }
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let pos = m.xy * dims - vec2<f32>(0.5);
    let base = floor(pos);
    let f = pos - base;
    let b = vec2<i32>(base);
    let c = f32(cls);
    let i00 = select(0.0, 1.0, semanticTexel(b).x == c);
    let i10 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(1, 0)).x == c);
    let i01 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(0, 1)).x == c);
    let i11 = select(0.0, 1.0, semanticTexel(b + vec2<i32>(1, 1)).x == c);
    let w = mix(mix(i00, i10, f.x), mix(i01, i11, f.x), f.y);
    return w * m.z * clamp(semParams.blend, 0.0, 1.0);
}

// The photo's own sky colour keyed against one of its pixels: ~1 where the
// photograph shows that sky (semParams.skyR/G/B, the mean of the pixels the map
// labelled sky), fading out a little below the horizon (a pitched-up camera
// sees sky below the pitch horizon). For the sky the network cannot see —
// through bare branches it labels vegetation. 0 without a map or without sky.
fn semanticSkyKey(uv: vec2<f32>, photo: vec3<f32>) -> f32 {
    if (semParams.blend <= 0.0 || semParams.skyR + semParams.skyG + semParams.skyB <= 0.0) { return 0.0; }
    let horizonY = sceneHorizonY();
    let d = photo - vec3<f32>(semParams.skyR, semParams.skyG, semParams.skyB);
    // Saturating: a sky pixel between twigs is fully sky; the twigs fall to 0.
    return smoothstep(0.2, 0.65, exp(-dot(d, d) * 20.0)) * smoothstep(horizonY + 0.25, horizonY + 0.1, uv.y);
}

// Rain over the sky: streak energy thinned where the map says sky, so rain
// reads as falling in front of the street rather than painted on the clouds.
fn semanticRain(streaks: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (semParams.blend <= 0.0) { return streaks; }
    return streaks * (1.0 - clamp(semParams.rainSky, 0.0, 1.0) * classWeight(uv, CLASS_SKY));
}

// Fog at the skyline: the bank lies below it, so over sky pixels its coverage
// relaxes instead of pooling as if the sky were the densest, farthest ground.
fn semanticFog(fogAmount: f32, uv: vec2<f32>) -> f32 {
    if (semParams.blend <= 0.0) { return fogAmount; }
    let sky = classWeight(uv, CLASS_SKY) * clamp(semParams.fogSky, 0.0, 1.0);
    return fogAmount * (1.0 - 0.55 * sky);
}

// Wet road: only road (and, weaker, sidewalk) pixels darken and pick up a
// rippled reflection of the frame mirrored about the horizon, stronger at a
// grazing distance (Fresnel) and dimmed at night. Zero on every other class.
fn semanticWetRoad(col: vec3<f32>, uv: vec2<f32>, rainAmount: f32, night: f32, t: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.wetRoad <= 0.0 || rainAmount <= 0.001) { return col; }
    let wet = classWeight(uv, CLASS_ROAD) + 0.6 * classWeight(uv, CLASS_SIDEWALK);
    if (wet <= 0.001) { return col; }
    let amount = clamp(wet, 0.0, 1.0) * clamp(semParams.wetRoad, 0.0, 1.0) * clamp(rainAmount, 0.0, 1.0);
    let horizonY = sceneHorizonY();
    let depth = clamp(sceneDepth(uv, horizonY), 0.0, 1.0);
    let ripple = (noise2D(uv * vec2<f32>(90.0, 220.0) + vec2<f32>(0.0, t * 1.7)) - 0.5) * 0.012;
    let mirrorY = 2.0 * horizonY - uv.y;
    let ruv = clamp(vec2<f32>(uv.x + ripple, mirrorY + ripple * 2.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let reflection = textureSampleLevel(sceneTex, linearSampler, ruv, 0.0).rgb;
    let inFrame = select(0.0, 1.0, mirrorY >= 0.0);
    let fresnel = mix(0.12, 0.55, depth) * mix(1.0, 0.15, clamp(night, 0.0, 1.0));
    return col * mix(1.0, 0.72, amount) + reflection * fresnel * amount * inFrame;
}

// Settled snow: road, sidewalk and (softer) vegetation whiten with the snow
// intensity — broken up near the camera, solid toward the horizon where the
// ground is seen at a grazing angle (the scene depth). Walls, vehicles,
// people and sky never collect it.
fn semanticSnowCover(col: vec3<f32>, uv: vec2<f32>, snowAmount: f32, night: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.snowCover <= 0.0 || snowAmount <= 0.001) { return col; }
    // Vegetation, but not the sky seen through its bare branches.
    let photo = textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb;
    let veg = classWeight(uv, CLASS_VEGETATION) * (1.0 - semanticSkyKey(uv, photo));
    let ground = classWeight(uv, CLASS_ROAD) + classWeight(uv, CLASS_SIDEWALK) + 0.45 * veg;
    if (ground <= 0.001) { return col; }
    let depth = clamp(sceneDepth(uv, sceneHorizonY()), 0.0, 1.0);
    let breakup = noise2D(uv * vec2<f32>(60.0, 140.0)) * 0.6 + noise2D(uv * vec2<f32>(240.0, 520.0)) * 0.4;
    let thickness = clamp(snowAmount * 0.8, 0.0, 1.0) * mix(0.55, 1.0, depth);
    let settle = smoothstep(1.0 - thickness, 1.0 - thickness * 0.4, breakup * 0.5 + thickness * 0.75);
    let cover = clamp(ground, 0.0, 1.0) * clamp(semParams.snowCover, 0.0, 1.0) * settle;
    let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let snowCol = vec3<f32>(0.92, 0.95, 1.0) * max(mix(0.85, 0.1, clamp(night, 0.0, 1.0)), lum * 1.3);
    return mix(col, snowCol, cover);
}

// Dusk-to-night relight, on top of applyNight: sky and vegetation sink
// further; building pixels darker than the wall around them (window recesses
// in a daytime photo) light up warm, a per-cell hash keeping ~40% lit with a
// slow flicker; road and sidewalk pick up sodium pools at depth-spaced lamp
// positions; vehicle pixels just above their lower edge get tail lights.
// People are never relit. `base` is the graded colour before applyNight.
fn semanticRelight(col: vec3<f32>, base: vec3<f32>, uv: vec2<f32>, night: f32, t: f32) -> vec3<f32> {
    if (semParams.blend <= 0.0 || semParams.relight <= 0.0 || night <= 0.001) { return col; }
    let k = clamp(semParams.relight, 0.0, 1.0) * clamp(night, 0.0, 1.0);
    // Sky seen through bare branches (labelled vegetation) sinks like the sky.
    let vegAll = classWeight(uv, CLASS_VEGETATION);
    let throughBranches = vegAll * semanticSkyKey(uv, textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb);
    let sky = classWeight(uv, CLASS_SKY) + throughBranches;
    let veg = vegAll - throughBranches;
    let building = classWeight(uv, CLASS_BUILDING);
    let road = classWeight(uv, CLASS_ROAD) + 0.7 * classWeight(uv, CLASS_SIDEWALK);
    let vehicle = classWeight(uv, CLASS_VEHICLE);
    var c = col * (1.0 - k * (0.45 * sky + 0.35 * veg));

    if (building > 0.001) {
        let px = vec2<f32>(5.0) / vec2<f32>(textureDimensions(sceneTex));
        let w709 = vec3<f32>(0.2126, 0.7152, 0.0722);
        let center = dot(textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb, w709);
        let around = (dot(textureSampleLevel(sceneTex, linearSampler, uv + vec2<f32>(px.x, 0.0), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv - vec2<f32>(px.x, 0.0), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv + vec2<f32>(0.0, px.y), 0.0).rgb, w709)
            + dot(textureSampleLevel(sceneTex, linearSampler, uv - vec2<f32>(0.0, px.y), 0.0).rgb, w709)) * 0.25;
        let recess = smoothstep(0.02, 0.12, around - center);
        let cell = floor(uv * vec2<f32>(64.0, 44.0));
        let lit = step(0.6, hash(cell + vec2<f32>(17.0, 3.0)));
        let phase = hash(cell + vec2<f32>(5.0, 41.0)) * 6.2832;
        let flicker = mix(0.88 + 0.12 * sin(t * 0.9 + phase), 1.0, clamp(semParams.stillness, 0.0, 1.0));
        c = c + vec3<f32>(1.0, 0.72, 0.42) * (building * recess * lit * flicker * k * 0.9);
    }

    if (road > 0.001) {
        let depth = clamp(sceneDepth(uv, sceneHorizonY()), 0.0, 1.0);
        let lampPhase = fract(depth * 7.0 + 0.35);
        let pool = exp(-pow((lampPhase - 0.5) * 4.5, 2.0)) * smoothstep(0.95, 0.55, depth);
        c = c + base * vec3<f32>(1.0, 0.66, 0.32) * (clamp(road, 0.0, 1.0) * pool * k * 1.3);
    }

    if (vehicle > 0.001) {
        // Tail and marker lights: a few soft red glows low on each vehicle (just
        // above where its mask ends), sparse along the row — not a lit stripe.
        let lower = classWeight(uv + vec2<f32>(0.0, 0.025), CLASS_VEHICLE);
        let below = classWeight(uv + vec2<f32>(0.0, 0.06), CLASS_VEHICLE);
        let band = vehicle * lower * (1.0 - below);
        let lamp = smoothstep(0.7, 0.92, noise2D(vec2<f32>(uv.x * 36.0, 7.0)));
        c = c + vec3<f32>(1.0, 0.1, 0.05) * (band * lamp * k * 0.6);
    }
    return c;
}

// Sky matte: the sky indicator upsampled from the class map by a joint
// bilateral filter — each of the four nearest map texels is weighted by how
// close the photo's colour at its centre is to this pixel's, so the matte
// follows rooflines and tree crowns instead of the map's texel grid — times
// the map's confidence. 0 without a map.
fn semanticSkyMatte(uv: vec2<f32>) -> f32 {
    if (semParams.blend <= 0.0) { return 0.0; }
    let m = semanticMapUv(uv);
    let dims = vec2<f32>(textureDimensions(semanticTex));
    let pos = m.xy * dims - vec2<f32>(0.5);
    let base = floor(pos);
    let f = pos - base;
    let here = textureSampleLevel(sceneTex, linearSampler, uv, 0.0).rgb;
    let shift = vec2<f32>(semParams.shiftX, semParams.shiftY);
    var num = 0.0;
    var den = 0.0;
    for (var j: i32 = 0; j < 4; j = j + 1) {
        let o = vec2<f32>(f32(j & 1), f32(j >> 1u));
        let tap = semanticTexel(vec2<i32>(base + o));
        let tapUv = (base + o + vec2<f32>(0.5)) / dims + shift;
        let tapCol = textureSampleLevel(sceneTex, linearSampler, clamp(tapUv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
        let d = here - tapCol;
        let spatial = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
        let w = spatial * exp(-dot(d, d) * 40.0) + 1e-4;
        num = num + w * select(0.0, smoothstep(0.35, 0.75, tap.y), tap.x == f32(CLASS_SKY));
        den = den + w;
    }
    // Plus the sky the network could not see: through bare branches it
    // labelled vegetation, keyed on the photo's own sky colour.
    let keyed = semanticSkyKey(uv, here) * classWeight(uv, CLASS_VEGETATION);
    return max((num / den) * m.z * clamp(semParams.blend, 0.0, 1.0), keyed);
}

// Compute only (#352): the GPU precipitation layer's rain share thins over the
// sky like semanticRain's streaks — the particles are rain *and* snow, and
// snow keeps falling in front of the sky.
fn semanticRainParticles(layer: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (semParams.blend <= 0.0) { return layer; }
    let rainShare = p_rainIntensity() / max(p_rainIntensity() + p_snowIntensity(), 0.0001);
    return layer * (1.0 - clamp(semParams.rainSky, 0.0, 1.0) * rainShare * classWeight(uv, CLASS_SKY));
}
