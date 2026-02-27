// Weather Post-Process Shader
// Dual-pass HDR weather effects: rain streaks + snow flakes
// 100% procedural, no textures, runs in rgba16float HDR

struct WeatherParams {
    // 0-5: color grading params
    vibrance     : f32,
    saturation   : f32,
    contrast     : f32,
    exposure     : f32,
    temperature  : f32,
    tint         : f32,
    // 6-10: weather params
    time         : f32,
    rainIntensity: f32,   // 0–2
    snowIntensity: f32,   // 0–2
    wind         : f32,   // -1.0 left → +1.0 right
    speed        : f32,   // 0.5–2.0 (global animation speed)
}

@group(0) @binding(0) var<uniform> p: WeatherParams;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

// Vertex shader - full screen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    // Generate a full-screen triangle
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

// Hash function for pseudo-random numbers
fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Color grading functions
fn applyVibrance(col: vec3<f32>, vibrance: f32) -> vec3<f32> {
    let avg = dot(col, vec3<f32>(0.3333));
    let maxC = max(max(col.r, col.g), col.b);
    let sat = maxC - avg;
    return col + (col - vec3<f32>(avg)) * vibrance * (1.0 - sat);
}

fn applySaturation(col: vec3<f32>, saturation: f32) -> vec3<f32> {
    let gray = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    return mix(vec3<f32>(gray), col, 1.0 + saturation);
}

fn applyContrast(col: vec3<f32>, contrast: f32) -> vec3<f32> {
    return (col - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);
}

fn applyExposure(col: vec3<f32>, exposure: f32) -> vec3<f32> {
    return col * pow(2.0, exposure);
}

fn applyTemperatureTint(col: vec3<f32>, temperature: f32, tint: f32) -> vec3<f32> {
    var c = col;
    c.r += temperature * 0.1;
    c.b -= temperature * 0.1;
    c.g += tint * 0.05;
    c.r -= tint * 0.025;
    c.b -= tint * 0.025;
    return c;
}

// Rain streaks (4 tilted layers, very cheap)
fn rain(uv: vec2<f32>, t: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let layer = f32(i);
        var st = uv * vec2<f32>(1.0, 3.0 + layer * 1.5);
        st.x = st.x + p.wind * (0.3 + layer * 0.2);
        st.y = st.y + t * (3.5 + layer * 2.2) * (0.8 + p.rainIntensity * 0.4);

        let seed = hash(vec2<f32>(floor(st.x * 42.0 + layer * 11.0), floor(st.y)));
        st.x = fract(st.x * 42.0) - 0.5 + (seed - 0.5) * 0.8;
        st.y = fract(st.y);

        let streak = smoothstep(0.96, 1.0, 1.0 - length(st * vec2<f32>(0.45, 3.2)));
        c = c + streak * (0.7 + seed * 0.8);
    }
    return c * 0.75;
}

// Snow flakes (5 drifting layers with gentle sway)
fn snow(uv: vec2<f32>, t: f32) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        var st = uv * (4.0 + layer * 3.2);
        st.x = st.x + p.wind * (0.5 + layer * 0.25);
        st.y = st.y + t * (0.6 + layer * 0.35);  // gentle fall
        st.x = st.x + sin(t * 1.8 + layer * 3.0 + st.y * 2.0) * 0.15;  // sway

        let id = floor(st);
        let rnd = hash(id + vec2<f32>(layer));
        st = fract(st) - vec2<f32>(0.5);

        let flake = smoothstep(0.18 + rnd * 0.07, 0.0, length(st));
        c = c + flake * (0.85 + rnd * 0.6);
    }
    return c * 1.35;
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(sceneTex));
    let uv = fragCoord.xy / texSize;
    var col = textureSample(sceneTex, linearSampler, uv).rgb;

    // === Color grading ===
    col = applyVibrance(col, p.vibrance);
    col = applySaturation(col, p.saturation);
    col = applyContrast(col, p.contrast);
    col = applyTemperatureTint(col, p.temperature, p.tint);
    col = applyExposure(col, p.exposure);

    // === Weather effects ===
    let t = p.time * p.speed;

    if (p.rainIntensity > 0.001) {
        let r = rain(uv, t) * p.rainIntensity;
        col = col + r * vec3<f32>(0.78, 0.88, 1.15);  // cool blue-ish glow
        col = col * (1.0 - p.rainIntensity * 0.22);   // wet darkening
    }
    
    if (p.snowIntensity > 0.001) {
        let s = snow(uv, t) * p.snowIntensity;
        col = col + s * vec3<f32>(1.15, 1.18, 1.22);  // bright snowy glow
    }

    // Final cheap dither to prevent banding
    let noise = fract(sin(dot(fragCoord.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    col = col + (noise - 0.5) * 0.0025;

    return vec4<f32>(col, 1.0);
}
