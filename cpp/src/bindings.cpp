/**
 * bindings.cpp
 * Raw ABI wrappers for the WebGPU StreetView WASM module.
 *
 * Provides thin aliases with canonical names (`seed`, `noise2d`, …) that
 * match the WAT module's exported symbols and the TypeScript loader ABI in
 * src/wasm/index.ts.  The underlying implementation lives in noise_module.cpp
 * (sw_* functions).
 *
 * When building with Emscripten:
 *   - CMakeLists.txt exports `_seed`, `_noise2d`, etc. via EXPORTED_FUNCTIONS.
 *   - STANDALONE_WASM=1 + --no-entry compiles sin/cos/atan2 statically so the
 *     binary has no env.* math imports (unlike the WAT module which imports them
 *     from the host).  The TS loader's importObject provides env.sin/cos/atan2
 *     regardless; extra keys in the import object are silently ignored.
 *
 * NOTE: embind (--bind) is intentionally NOT used here.  The TS loader
 * instantiates the binary directly via WebAssembly.instantiate(), not through
 * Emscripten's Module() factory.
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include "streetview_wasm.h"

extern "C" {

/** Seed the permutation table. Canonical export name matches WAT: 'seed'. */
EMSCRIPTEN_KEEPALIVE
void seed(unsigned int s) { sw_seed(s); }

/** 2-D Perlin gradient noise [-1, 1]. Matches WAT export: 'noise2d'. */
EMSCRIPTEN_KEEPALIVE
float noise2d(float x, float y) { return sw_noise2d(x, y); }

/**
 * Fill a Float32 buffer with noise values (row-major).
 * Matches WAT export: 'fill_noise_buffer'.
 * ptr is a byte offset into WASM linear memory; the TS loader passes 512
 * (past the 512-byte permutation table scratch region).
 */
EMSCRIPTEN_KEEPALIVE
void fill_noise_buffer(float* buf, int w, int h,
                       float scale, float ox, float oy) {
    sw_fill_noise_buffer(buf, w, h, scale, ox, oy);
}

/** fBm over noise2d, normalised to [-1, 1]. Matches WAT export: 'fbm2d'. */
EMSCRIPTEN_KEEPALIVE
float fbm2d(float x, float y, int octaves, float lacunarity, float gain) {
    return sw_fbm2d(x, y, octaves, lacunarity, gain);
}

/**
 * Fill a Float32 buffer with fBm samples (row-major).
 * Matches WAT export: 'fill_fbm_buffer'.
 */
EMSCRIPTEN_KEEPALIVE
void fill_fbm_buffer(float* buf, int w, int h,
                     float scale, float ox, float oy,
                     int octaves, float lacunarity, float gain) {
    sw_fill_fbm_buffer(buf, w, h, scale, ox, oy, octaves, lacunarity, gain);
}

/**
 * Write 4 floats per particle (x, y, speed, phase).
 * Matches WAT export: 'fill_particle_seeds'.
 */
EMSCRIPTEN_KEEPALIVE
void fill_particle_seeds(float* buf, int count, unsigned int s) {
    sw_fill_particle_seeds(buf, count, s);
}

/** Haversine great-circle distance in metres. Matches WAT export: 'haversine'. */
EMSCRIPTEN_KEEPALIVE
double haversine(double lat1, double lon1, double lat2, double lon2) {
    return sw_haversine(lat1, lon1, lat2, lon2);
}

/**
 * Per-segment haversine over a polyline of `count` [lat, lon] pairs.
 * Writes count-1 segment distances to `out` and returns the total.
 * Matches WAT export: 'batch_haversine'.
 */
EMSCRIPTEN_KEEPALIVE
double batch_haversine(const double* points, int count, double* out) {
    return sw_batch_haversine(points, count, out);
}

/** Normalize angle to [0, 360). Matches WAT export: 'normalize_angle'. */
EMSCRIPTEN_KEEPALIVE
float normalize_angle(float angle) { return sw_normalize_angle(angle); }

/** Smallest signed angle difference (-180, 180]. Matches WAT export: 'signed_angle_diff'. */
EMSCRIPTEN_KEEPALIVE
float signed_angle_diff(float from, float to) { return sw_signed_angle_diff(from, to); }

/**
 * Mono engine+road PCM. Matches WAT export: 'fill_engine_noise'.
 */
EMSCRIPTEN_KEEPALIVE
void fill_engine_noise(float* buf, int count,
                       float rpm, float load, float speed_kmh,
                       float time_sec, float sample_rate) {
    sw_fill_engine_noise(buf, count, rpm, load, speed_kmh, time_sec, sample_rate);
}

} // extern "C"
#endif // __EMSCRIPTEN__
