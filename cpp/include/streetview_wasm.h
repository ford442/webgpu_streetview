#pragma once
/**
 * streetview_wasm.h
 * Public API for the WebGPU StreetView WASM module.
 *
 * Compiled with Emscripten:
 *   emcc -O3 -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 ...
 */

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Seed the internal permutation table used by noise functions.
 * Call once before using any noise or particle functions.
 * @param seed  Any non-zero 32-bit integer.
 */
void sw_seed(unsigned int seed);

/**
 * 2-D gradient (Perlin-style) noise.
 * @param x  World-space x coordinate.
 * @param y  World-space y coordinate.
 * @return   Value in [-1.0, 1.0].
 */
float sw_noise2d(float x, float y);

/**
 * Fill a Float32 buffer with 2-D noise samples.
 * The buffer is laid out row-major: buf[row * width + col].
 *
 * @param buf     Pointer to a caller-owned float array of size (width * height).
 * @param width   Number of columns.
 * @param height  Number of rows.
 * @param scale   Spatial frequency (larger = more zoomed-out pattern).
 * @param offsetX World-space X offset.
 * @param offsetY World-space Y offset.
 */
void sw_fill_noise_buffer(float* buf, int width, int height,
                          float scale, float offsetX, float offsetY);

/**
 * Haversine great-circle distance between two WGS-84 points.
 * @return Distance in metres.
 */
double sw_haversine(double lat1, double lon1, double lat2, double lon2);

/**
 * Normalise an angle to [0, 360).
 */
float sw_normalize_angle(float angle);

/**
 * Smallest signed angle difference, result in (-180, 180].
 */
float sw_signed_angle_diff(float from, float to);

#ifdef __cplusplus
} // extern "C"
#endif
