/**
 * Shared constants and the blit shader for the compute weather post-process
 * path. Split out of `ComputeWeatherPostProcessor.ts` — see `./index.ts`.
 */

// Must match NOISE_TILE_SIZE in src/renderer/weatherNoiseTile.ts and the storage
// buffer declared in weather-post.wgsl. The compute variant binds this tile at
// binding 12 (the image_video_effects `plasmaBuffer` slot), where the shader
// reads it as 1024 vec4s — 4096 floats, exactly one 64x64 tile.
const NOISE_TILE_SIZE = 64;
export const NOISE_BUFFER_BYTES = NOISE_TILE_SIZE * NOISE_TILE_SIZE * 4;

// image_video_effects-compatible Uniforms struct size:
// config(vec4) + zoom_config(vec4) + zoom_params(vec4) + ripples(array<vec4,50>)
export const COMPUTE_UNIFORMS_BYTE_SIZE = (4 + 4 + 4 + 50 * 4) * 4;

export const WORKGROUP_SIZE = 16;

/**
 * Format of the weather output (binding 2) and the colour history copied from
 * it (binding 9). Half float: the pass writes post-ACES display values plus
 * dither, which 16-bit float carries without visible loss, at half the
 * bandwidth of `rgba32float` (8 vs 16 B/px, read back by the blit every frame).
 * `rgba16float` is a core storage-texture format, so no feature is needed.
 * Must match `writeTexture`'s declaration in `weather-post-compute.wgsl`.
 *
 * The particle textures (bindings 7/8 and their dummies) stay `rgba32float`:
 * they carry simulation state integrated every frame, and one storage
 * declaration in `weather-particles.wgsl` serves both state and density.
 */
export const COMPUTE_WEATHER_OUTPUT_FORMAT: GPUTextureFormat = 'rgba16float';

/** Particle uniforms: dt + grid dims + density dims, padded to 8 floats. */
export const PARTICLE_UNIFORMS_BYTE_SIZE = 32;

export const BLIT_SHADER = `
@group(0) @binding(0) var srcTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let coord = vec2<i32>(fragCoord.xy);
    return textureLoad(srcTex, coord, 0);
}
`;
