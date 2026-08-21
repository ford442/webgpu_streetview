#pragma once
/**
 * streetview_wasm.h
 * Public API for the WebGPU StreetView WASM module (internal sw_* names).
 *
 * The canonical external ABI (exported from both the WAT module and the
 * Emscripten build) uses plain names without the sw_ prefix:
 *   seed, noise2d, fill_noise_buffer, fbm2d, fill_fbm_buffer,
 *   fill_particle_seeds, haversine, batch_haversine,
 *   normalize_angle, signed_angle_diff, fill_engine_noise,
 *   luma_histogram_bt709, reduce_luma_bt709, downsample_2d
 *
 * Thin wrappers in bindings.cpp alias these internal sw_* functions to the
 * canonical names for Emscripten EXPORTED_FUNCTIONS.
 *
 * Build with Emscripten (standalone raw-WASM mode, no JS glue):
 *   emcmake cmake ... && emmake make
 *   Flags: -s STANDALONE_WASM=1 --no-entry (see CMakeLists.txt)
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
 * Fractal Brownian motion over sw_noise2d.
 *
 * @param octaves    Number of octaves to sum (<= 0 returns 0).
 * @param lacunarity Frequency multiplier per octave (2.0 is the usual value).
 * @param gain       Amplitude multiplier per octave (0.5 is the usual value).
 * @return           Value in [-1, 1] — the sum is divided by the accumulated
 *                   amplitude so the range is octave-count independent.
 */
float sw_fbm2d(float x, float y, int octaves, float lacunarity, float gain);

/**
 * Fill a Float32 buffer with fBm samples.  Same tile layout as
 * sw_fill_noise_buffer; every sample is an fBm stack instead of one octave.
 */
void sw_fill_fbm_buffer(float* buf, int width, int height,
                        float scale, float offsetX, float offsetY,
                        int octaves, float lacunarity, float gain);

/**
 * Generate deterministic particle spawn seeds: 4 floats per particle —
 * x [0,1), y [0,1), speed [0.5,1.5), phase [0, 2π).
 *
 * @param buf    Caller-owned float array of size (count * 4).
 * @param count  Number of particles.
 * @param seed   Any 32-bit integer; the same seed always yields the same set.
 */
void sw_fill_particle_seeds(float* buf, int count, unsigned int seed);

/**
 * Haversine great-circle distance between two WGS-84 points.
 * @return Distance in metres.
 */
double sw_haversine(double lat1, double lon1, double lat2, double lon2);

/**
 * Haversine distance for a whole polyline in one call.
 *
 * @param points  `count` consecutive [lat, lon] pairs (2 doubles each).
 * @param count   Number of points.
 * @param out     Caller-owned array of at least (count - 1) doubles; receives
 *                the per-segment distances in metres.  Untouched when count < 2.
 * @return        Sum of the segment distances in metres (0 when count < 2).
 */
double sw_batch_haversine(const double* points, int count, double* out);

/**
 * Normalise an angle to [0, 360).
 */
float sw_normalize_angle(float angle);

/**
 * Smallest signed angle difference, result in [-180, 180).
 * Exactly-opposite inputs return -180, not +180.
 */
float sw_signed_angle_diff(float from, float to);

/**
 * Fill a mono PCM buffer with engine + road noise.
 * Samples are f32 in [-1, 1]. Deterministic for a given (rpm, load, speed,
 * time, sampleRate) so the JS fallback can match the WAT/C++ path.
 *
 * @param buf          Caller-owned float array of length `count`.
 * @param count        Number of samples to write.
 * @param rpm          Engine RPM (>= 0).
 * @param load         Throttle/load in [0, 1].
 * @param speed_kmh    Road speed in km/h (>= 0).
 * @param time_sec     Stream time at sample 0 (seconds, >= 0).
 * @param sample_rate  Audio sample rate (Hz). Values <= 1 fall back to 44100.
 */
void sw_fill_engine_noise(float* buf, int count,
                          float rpm, float load, float speed_kmh,
                          float time_sec, float sample_rate);

/**
 * 256-bin Rec.709 luma histogram of packed RGBA8 (row-major, 4 bytes/pixel).
 * `bins` is 256 uint32 counts; zeroed then filled. No-op when width/height <= 0.
 */
void sw_luma_histogram_bt709(const unsigned char* rgba, int width, int height,
                             unsigned int* bins);

/**
 * Rec.709 luma reduce: writes three f32 values {mean, min, max} in [0, 1].
 * Empty input writes zeros.
 */
void sw_reduce_luma_bt709(const unsigned char* rgba, int width, int height,
                          float* out3);

/**
 * Integer box-filter downsample of packed RGBA8 into packed RGBA8.
 */
void sw_downsample_2d(const unsigned char* src, int src_w, int src_h,
                      unsigned char* dst, int dst_w, int dst_h);

#ifdef __cplusplus
} // extern "C"
#endif
