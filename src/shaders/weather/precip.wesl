import package::lib::noise::hash;
import package::lib::sceneDepth::{depthParams, sceneDepth};
import package::weather::bindings::{p_rainIntensity, p_wind};
import package::weather::depth::precipOcclusion;
import package::weather::horizon::sceneHorizonY;

// Improved rain with camera panning support for world-space effect
fn rain(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    // Depth first: with a depth map, layers behind the nearest surface are
    // occluded (precipOcclusion). Without one, depth is the proxy and unused
    // until the perspective cue below.
    let horizonY = sceneHorizonY();
    let depth = sceneDepth(uv, horizonY);
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let layer = f32(i);
        var st = uv * vec2<f32>(1.0, 3.0 + layer * 1.5);
        
        // Offset by camera pan to make rain feel like it's in world space
        // Closer layers (lower i) move more than distant ones (parallax)
        let parallaxFactor = 10.0 + layer * 5.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.5; // Less vertical parallax
        
        st.x = st.x + p_wind() * (0.3 + layer * 0.2);
        st.y = st.y - t * (3.5 + layer * 2.2) * (0.8 + p_rainIntensity() * 0.4);

        let seed = hash(vec2<f32>(floor(st.x * 42.0 + layer * 11.0), floor(st.y)));
        st.x = fract(st.x * 42.0) - 0.5 + (seed - 0.5) * 0.8;
        st.y = fract(st.y);

        // Rotate streak axis to match wind direction — aggressive slant at high wind
        let tiltAngle = atan(p_wind() * 1.2);
        let cosT = cos(tiltAngle);
        let sinT = sin(tiltAngle);
        let stTilted = vec2<f32>(st.x * cosT - st.y * sinT, st.x * sinT + st.y * cosT);
        let streak = smoothstep(0.96, 1.0, 1.0 - length(stTilted * vec2<f32>(0.45, 3.2)));
        if (depthParams.blend > 0.0) {
            c = c + streak * (0.7 + seed * 0.8) * precipOcclusion(layer, 4.0, depth);
        } else {
            c = c + streak * (0.7 + seed * 0.8);
        }
    }

    // Perspective cue: streaks fade toward a haze above the shared horizon and
    // gain presence approaching the camera below it, so rain reads as falling
    // through the same depth the fog/DOF horizon uses instead of a flat,
    // pitch-invariant overlay (the "floats on a flat screen-Y plane" gap).
    let skyFade = smoothstep(horizonY - 0.35, horizonY + 0.05, uv.y);
    let nearBoost = mix(1.0, 1.3, 1.0 - depth);
    return c * 0.75 * mix(0.35, 1.0, skyFade) * nearBoost;
}

// Improved snow with camera panning support for world-space effect
fn snow(uv: vec2<f32>, t: f32, panX: f32, panY: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    let horizonY = sceneHorizonY();
    let depth = sceneDepth(uv, horizonY);
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        var st = uv * (4.0 + layer * 3.2);
        
        // Offset by camera pan to make snow feel like it's in world space
        // Each layer has different parallax depth for 3D feel
        let parallaxFactor = 8.0 + layer * 4.0;
        st.x = st.x + panX * parallaxFactor;
        st.y = st.y + panY * parallaxFactor * 0.6;
        
        st.x = st.x + p_wind() * (0.5 + layer * 0.25);
        st.y = st.y - t * (0.6 + layer * 0.35);
        st.x = st.x + sin(t * 1.8 + layer * 3.0 + st.y * 2.0) * 0.15;

        let id = floor(st);
        let rnd = hash(id + vec2<f32>(layer));
        st = fract(st) - vec2<f32>(0.5);

        // Gently tilt snowflake placement with wind — softer factor than rain
        let snowTilt = atan(p_wind() * 0.6);
        let cosST = cos(snowTilt);
        let sinST = sin(snowTilt);
        let stTilted = vec2<f32>(st.x * cosST - st.y * sinST, st.x * sinST + st.y * cosST);
        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(stTilted));
        if (depthParams.blend > 0.0) {
            c = c + flake * (0.85 + rnd * 0.6) * precipOcclusion(layer, 5.0, depth);
        } else {
            c = c + flake * (0.85 + rnd * 0.6);
        }
    }

    // Same horizon/depth perspective cue as rain() — see comment there.
    let skyFade = smoothstep(horizonY - 0.35, horizonY + 0.05, uv.y);
    let nearBoost = mix(1.0, 1.3, 1.0 - depth);
    return c * 1.35 * mix(0.35, 1.0, skyFade) * nearBoost;
}
