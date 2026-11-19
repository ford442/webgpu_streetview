import package::weather::bindings::{p_cameraPitch, p_horizonBlend, p_horizonEstimateY};

// ============================================================================
// CAMERA-AWARE COORDINATE TRANSFORMATION
// ============================================================================

// Convert world azimuth (radians, SunCalc: 0=S, π/2=W, π=N, -π/2=E) 
// to screen-space X coordinate (0-1), accounting for camera heading.
// This ensures sun/moon appear at correct on-screen positions when panning.
fn worldAzimuthToScreenX(azimuth: f32, cameraHeadingNorm: f32) -> f32 {
    // Normalize azimuth to 0-1 range (same as original sunNormX calculation)
    let worldNormX = fract((azimuth + 3.14159265) / (2.0 * 3.14159265));
    // Offset by camera heading to get screen position
    var screenX = worldNormX - cameraHeadingNorm + 0.5;
    // Wrap to 0-1 range
    return fract(screenX);
}

// Get the shortest signed distance between two normalized coordinates (0-1)
fn normalizedDistance(a: f32, b: f32) -> f32 {
    var d = a - b;
    if (d > 0.5) { d = d - 1.0; }
    if (d < -0.5) { d = d + 1.0; }
    return d;
}

// ============================================================================
// CHEAP DEPTH PROXY (no depth buffer — Street View gives us none)
// ============================================================================
// The panorama is a sphere around the eye, so screen Y alone tells us a lot:
// everything above the horizon line is effectively at infinity (sky/skyline),
// and ground pixels below it get closer as they approach the bottom of the
// frame. `viewHorizonY` tracks where that line sits as the camera pitches.

// Screen-space Y (top-origin, 0-1) of the horizon for a normalized camera
// pitch (0.5 = level). ~90 degree vertical FOV => 1 pitch unit ~ 2 screens.
// `blend` pulls that pitch prediction toward `estimateY`, the image-derived
// horizon (src/renderer/gpuChores/horizonEstimate.ts). blend 0 takes the
// `select` branch and returns the pitch-only horizon bit-exactly.
fn viewHorizonY(cameraPitchNorm: f32, estimateY: f32, blend: f32) -> f32 {
    let predicted = 0.5 + (cameraPitchNorm - 0.5) * 2.0;
    let w = clamp(blend, 0.0, 1.0);
    return clamp(select(predicted, mix(predicted, estimateY, w), w > 0.0), -0.75, 1.75);
}

// The horizon every weather effect reads: pitch prediction + image estimate.
fn sceneHorizonY() -> f32 {
    return viewHorizonY(p_cameraPitch(), p_horizonEstimateY(), p_horizonBlend());
}
