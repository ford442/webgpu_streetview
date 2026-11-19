import package::weather::bindings::{lut3d, lutSampler};

// ============================================================================
// COLOR GRADING FUNCTIONS
// ============================================================================

fn applyVibrance(col: vec3<f32>, vibrance: f32) -> vec3<f32> {
    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    let maxC = max(max(col.r, col.g), col.b);
    let sat = maxC - luma;
    return col + (col - vec3<f32>(luma)) * vibrance * (1.0 - sat);
}

fn applySaturation(col: vec3<f32>, saturation: f32) -> vec3<f32> {
    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luma), col, 1.0 + saturation);
}

fn applyContrast(col: vec3<f32>, contrast: f32) -> vec3<f32> {
    return (col - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);
}

fn applyExposure(col: vec3<f32>, exposure: f32) -> vec3<f32> {
    return col * pow(2.0, exposure);
}

fn applyLut(color: vec3<f32>) -> vec3<f32> {
    let dim = textureDimensions(lut3d).x;
    if (dim <= 1u) {
        return color;
    }
    let n = f32(dim);
    let uvw = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    let uvwC = (uvw * (n - 1.0) + vec3<f32>(0.5)) / n;
    return textureSampleLevel(lut3d, lutSampler, uvwC, 0.0).rgb;
}

fn kelvinToRGB(kelvin: f32) -> vec3<f32> {
    var rgb = vec3<f32>(255.0);
    let temp = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    
    if (temp > 66.0) {
        rgb.r = 329.698727446 * pow(temp - 60.0, -0.1332047592);
        rgb.r = clamp(rgb.r, 0.0, 255.0);
    }
    
    if (temp <= 66.0) {
        rgb.g = 99.4708025861 * log(temp) - 161.1195681661;
    } else {
        rgb.g = 288.1221695283 * pow(temp - 60.0, -0.0755148492);
    }
    rgb.g = clamp(rgb.g, 0.0, 255.0);
    
    if (temp < 66.0) {
        if (temp > 19.0) {
            rgb.b = 138.5177312231 * log(temp - 10.0) - 305.0447927307;
            rgb.b = clamp(rgb.b, 0.0, 255.0);
        } else {
            rgb.b = 0.0;
        }
    }
    
    return rgb / 255.0;
}

fn applyTemperatureTint(col: vec3<f32>, temperature: f32, tint: f32) -> vec3<f32> {
    let kelvin = 6500.0 + temperature * 5000.0;
    let kelvinRGB = kelvinToRGB(kelvin);
    let neutralRGB = kelvinToRGB(6500.0);
    var tempMult = kelvinRGB / neutralRGB;
    
    tempMult.g = tempMult.g * (1.0 + tint * 0.1);
    tempMult.r = tempMult.r * (1.0 + tint * 0.05);
    tempMult.b = tempMult.b * (1.0 + tint * 0.05);
    
    return col * tempMult;
}

// ============================================================================
// HDR TONEMAPPING
// ============================================================================

// ACES (Academy Color Encoding System) Filmic Tonemapping
// Smoothly compresses high dynamic range values to displayable range
// Prevents harsh clipping of bright highlights (sun flares, headlights, etc.)
//
// `hdr_grade` (`?hdr` accepted: the swap chain applied `extended` tone mapping)
// links the output-referred body instead. The ACES shoulder is evaluated
// against the display headroom (EXTENDED_TONEMAP_HEADROOM in
// src/renderer/shaderFeatureVariants.ts) instead of assuming SDR white is the
// peak, so sun flare / headlights land in the extended range the swap chain can
// actually show instead of being clamped flat at 1.0. At headroom 1.0 it
// reduces exactly to the SDR body.
@if(hdr_grade)
fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    let headroom = 4.0;
    let x = color / headroom;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0)) * headroom;
}
@else
fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
