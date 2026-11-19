// Weather-only depth helpers: the fog layer profile and per-layer
// precipitation occlusion. The depth itself is lib/sceneDepth.wesl's sceneDepth().

// Vertical density profile of a fog layer. `height` 0 keeps the bank hugging
// the ground (dense at the horizon line, thinning upward); 1 lifts it into an
// elevated haze band that leaves the road clear.
fn fogHeightFalloff(uv: vec2<f32>, horizonY: f32, height: f32) -> f32 {
    let altitude = clamp((horizonY - uv.y) / max(horizonY, 0.15), 0.0, 1.0);
    let ground   = exp(-altitude * 3.2);
    let elevated = smoothstep(0.0, 0.5, altitude) * exp(-max(altitude - 0.5, 0.0) * 2.4);
    return mix(ground, elevated, clamp(height, 0.0, 1.0));
}

// Scene-depth occlusion for one precipitation layer (#320). Layer 0 is the
// nearest to the lens, the last the farthest; a layer's drops are hidden where
// the scene surface is nearer than the layer — a wall at arm's length has no
// far rain in front of it, while the far end of the street gets the whole
// curtain. Only called when a depth map is blended in (depthParams.blend > 0);
// without one, rain() and snow() take their unchanged accumulate.
fn precipOcclusion(layer: f32, layerCount: f32, sceneD: f32) -> f32 {
    let layerDepth = 0.06 + 0.9 * pow(layer / max(layerCount - 1.0, 1.0), 1.5);
    return smoothstep(layerDepth * 0.7, layerDepth * 1.15 + 0.02, sceneD);
}
