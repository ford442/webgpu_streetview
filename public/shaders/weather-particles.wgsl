// GPU precipitation integrate + splat — compute weather path only.
// Driven by WASM fill_particle_seeds (x, y, speed, phase) uploaded once /
// on count change. Per-frame motion stays on the GPU.
//
// extraBuffer indices match weatherUniformLayout.ts / weather-post-compute.wgsl.
// Fall Y sign is -1 (top-origin UV) — same contract as carSpatialModel.WEATHER_FALL_Y_SIGN.
//
// All entry points share one bind group:
//   0 srcTex  (state read)
//   1 dstTex  (state write or density write)
//   2 extraBuffer
//   3 uniforms

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var dstTex: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<storage, read> extraBuffer: array<f32>;
@group(0) @binding(3) var<uniform> u: ParticleUniforms;

struct ParticleUniforms {
    dt_grid: vec4<f32>,   // x=dt, y=gridW, z=gridH, w=unused
    density: vec4<f32>,   // x=densityW, y=densityH
};

fn ep(i: i32) -> f32 { return extraBuffer[i]; }
fn p_time() -> f32 { return ep(6); }
fn p_rainIntensity() -> f32 { return ep(7); }
fn p_snowIntensity() -> f32 { return ep(8); }
fn p_wind() -> f32 { return ep(9); }
fn p_speed() -> f32 { return max(ep(10), 0.001); }

// Keep in lockstep with src/renderer/weatherParticles.ts
const FALL_Y: f32 = -1.0;
const WIND_SCALE: f32 = 0.35;
const FALL_SPEED: f32 = 0.55;

fn wrap01(v: f32) -> f32 {
    return fract(v + 1.0);
}

fn storeDst(coord: vec2<i32>, color: vec4<f32>, dims: vec2<i32>) {
    if (coord.x < 0 || coord.y < 0 || coord.x >= dims.x || coord.y >= dims.y) {
        return;
    }
    textureStore(dstTex, coord, color);
}

@compute @workgroup_size(16, 16, 1)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let gridW = u32(u.dt_grid.y);
    let gridH = u32(u.dt_grid.z);
    if (id.x >= gridW || id.y >= gridH) {
        return;
    }
    let coord = vec2<i32>(id.xy);
    var p = textureLoad(srcTex, coord, 0);
    let rainI = p_rainIntensity();
    let snowI = p_snowIntensity();
    let precip = rainI + snowI;
    if (precip < 0.001) {
        textureStore(dstTex, coord, p);
        return;
    }

    let dt = u.dt_grid.x;
    let speed = max(p.z, 0.15);
    let phase = p.w;
    let t = p_time() * p_speed();
    let rainFrac = rainI / max(precip, 0.001);
    // Rain streaks fall faster than snow; mix by current intensities.
    let fall = FALL_SPEED * mix(0.45, 1.25, rainFrac);

    p.x = wrap01(p.x + p_wind() * WIND_SCALE * speed * dt);
    p.x = wrap01(p.x + sin(t * 1.8 + phase) * snowI * 0.12 * dt);
    p.y = wrap01(p.y + FALL_Y * fall * speed * dt * p_speed());

    textureStore(dstTex, coord, p);
}

@compute @workgroup_size(16, 16, 1)
fn clear_density(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = vec2<u32>(u32(u.density.x), u32(u.density.y));
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    textureStore(dstTex, vec2<i32>(id.xy), vec4<f32>(0.0));
}

@compute @workgroup_size(16, 16, 1)
fn splat(@builtin(global_invocation_id) id: vec3<u32>) {
    let gridW = u32(u.dt_grid.y);
    let gridH = u32(u.dt_grid.z);
    if (id.x >= gridW || id.y >= gridH) {
        return;
    }
    let p = textureLoad(srcTex, vec2<i32>(id.xy), 0);
    let rainI = p_rainIntensity();
    let snowI = p_snowIntensity();
    let precip = rainI + snowI;
    if (precip < 0.001) {
        return;
    }

    let dens = vec2<f32>(u.density.xy);
    let dims = vec2<i32>(i32(dens.x), i32(dens.y));
    let center = vec2<i32>(p.xy * dens);
    // Pack view-depth-ish layer into alpha so the weather pass can occlude
    // flakes behind the reconstructed ground / skyline.
    let layer = 0.06 + fract(p.w * 0.1591549) * 0.85;
    let rainFrac = rainI / max(precip, 0.001);
    let rainCol = vec3<f32>(0.70, 0.82, 1.12) * rainI;
    let snowCol = vec3<f32>(1.18, 1.20, 1.24) * snowI;
    let rgb = rainCol * 0.55 + snowCol;
    let weight = clamp(precip, 0.0, 1.0);

    storeDst(center, vec4<f32>(rgb * weight, layer), dims);
    storeDst(center + vec2<i32>(1, 0), vec4<f32>(rgb * weight * 0.45, layer), dims);
    storeDst(center + vec2<i32>(-1, 0), vec4<f32>(rgb * weight * 0.45, layer), dims);
    storeDst(center + vec2<i32>(0, 1), vec4<f32>(rgb * weight * 0.35, layer), dims);
    storeDst(center + vec2<i32>(0, -1), vec4<f32>(rgb * weight * 0.35, layer), dims);

    // Rain streaks stretch along fall + wind in density space.
    if (rainFrac > 0.2) {
        let wind = p_wind();
        let dir = vec2<i32>(i32(sign(wind)), 1);
        storeDst(center + dir, vec4<f32>(rainCol * weight * 0.5, layer), dims);
        storeDst(center + dir * 2, vec4<f32>(rainCol * weight * 0.28, layer), dims);
        storeDst(center + dir * 3, vec4<f32>(rainCol * weight * 0.16, layer), dims);
    }
}
