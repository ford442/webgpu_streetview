/**
 * noise_module.cpp
 * Gradient noise and utility math for WebGPU StreetView WASM module.
 *
 * Implements a classic Perlin gradient noise (2D) plus utility functions that
 * mirror src/utils/navigation.ts so they can be tested against the JS versions.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <span>

// ---------------------------------------------------------------------------
// Permutation table (512 entries, duplicated for wrap-around).
// ---------------------------------------------------------------------------
static uint8_t perm[512];

// Gradient vectors for 2-D Perlin noise (8 directions).
// Diagonal vectors use 1/√2 ≈ 0.7071 for unit-length normalisation.
static const float SQRT2_INV = 0.70710678f;
static const float grad2[8][2] = {
    { 1.0f,       0.0f      },
    {-1.0f,       0.0f      },
    { 0.0f,       1.0f      },
    { 0.0f,      -1.0f      },
    { SQRT2_INV,  SQRT2_INV },
    {-SQRT2_INV,  SQRT2_INV },
    { SQRT2_INV, -SQRT2_INV },
    {-SQRT2_INV, -SQRT2_INV },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
static inline float fade(float t) {
    // 6t^5 - 15t^4 + 10t^3  (Perlin's improved smoothstep)
    return t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f);
}

static inline float lerp(float a, float b, float t) {
    return a + t * (b - a);
}

static inline float grad2d(int hash, float x, float y) {
    const float* g = grad2[hash & 7];
    return g[0] * x + g[1] * y;
}

static inline int fast_floor(float x) {
    int xi = (int)x;
    // Explicit int -> float so -Wconversion stays clean; the comparison
    // already happened in float, so the semantics are unchanged.
    return x < static_cast<float>(xi) ? xi - 1 : xi;
}

// ---------------------------------------------------------------------------
// Cabin impulse responses (sw_fill_cabin_ir)
// ---------------------------------------------------------------------------
// One profile per vehicle in src/car/VehicleManager.ts, in the same order as
// CABIN_IR_VEHICLE_INDEX in src/car/audio/cabinIr.ts. Times are milliseconds;
// they are converted to taps with the caller's sample rate.
struct CabinProfile {
    float reflect_ms[3];    // early reflection arrival times
    float reflect_gain[3];  // their level relative to the direct path
    float tail_level;       // diffuse tail level at the first tap
    float tail_ms;          // 1/e decay time of that tail
    float damp_closed;      // one-pole brightness with the cabin sealed
    float damp_open;        // ... and with the roof/windows fully open
};

static const CabinProfile cabin_profiles[] = {
    // sedan — mid-size saloon, soft trim
    {{1.15f, 1.90f, 2.70f}, {0.42f, 0.26f, 0.17f}, 0.30f, 2.20f, 0.30f, 0.88f},
    // convertible — small hard-walled cabin that all but vanishes roof-down
    {{0.85f, 1.45f, 2.05f}, {0.34f, 0.20f, 0.11f}, 0.22f, 1.50f, 0.38f, 0.95f},
    // science-lab — boxy instrument bay, longest tail
    {{1.40f, 2.35f, 3.10f}, {0.46f, 0.31f, 0.22f}, 0.38f, 3.10f, 0.26f, 0.82f},
    // limousine — long cabin, late reflections, heavy absorption
    {{1.75f, 2.80f, 3.60f}, {0.40f, 0.28f, 0.20f}, 0.34f, 3.60f, 0.22f, 0.80f},
    // cortianics — sport GT: tight, bright, close reflections
    {{0.95f, 1.60f, 2.30f}, {0.38f, 0.24f, 0.15f}, 0.26f, 1.80f, 0.34f, 0.92f},
};

static const int cabin_profile_count =
    (int)(sizeof(cabin_profiles) / sizeof(cabin_profiles[0]));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

void sw_seed(unsigned int seed) {
    // Fill perm[0..255] with a linear congruential shuffle.
    uint8_t tmp[256];
    for (int i = 0; i < 256; ++i) tmp[i] = (uint8_t)i;

    // LCG-based Fisher-Yates shuffle.
    uint32_t state = seed;
    for (int i = 255; i > 0; --i) {
        state = state * 1664525u + 1013904223u;
        int j = (int)((state >> 16) & 0x7FFF) % (i + 1);
        uint8_t t = tmp[i]; tmp[i] = tmp[j]; tmp[j] = t;
    }
    memcpy(perm, tmp, 256);
    memcpy(perm + 256, tmp, 256);
}

float sw_noise2d(float x, float y) {
    int ix = fast_floor(x);
    int iy = fast_floor(y);

    float fx = x - (float)ix;
    float fy = y - (float)iy;

    float u = fade(fx);
    float v = fade(fy);

    // Wrap to [0, 255].
    int X = ix & 255;
    int Y = iy & 255;

    // Gradient values at four corners.
    float n00 = grad2d(perm[perm[X    ] + Y    ], fx,       fy      );
    float n10 = grad2d(perm[perm[X + 1] + Y    ], fx - 1.f, fy      );
    float n01 = grad2d(perm[perm[X    ] + Y + 1], fx,       fy - 1.f);
    float n11 = grad2d(perm[perm[X + 1] + Y + 1], fx - 1.f, fy - 1.f);

    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

void sw_fill_noise_buffer(float* buf, int width, int height,
                          float scale, float offsetX, float offsetY) {
    const float inv_scale = 1.0f / scale;
    const std::span<float> out(buf, static_cast<size_t>(width) * static_cast<size_t>(height));
    for (int row = 0; row < height; ++row) {
        for (int col = 0; col < width; ++col) {
            float nx = ((float)col + offsetX) * inv_scale;
            float ny = ((float)row + offsetY) * inv_scale;
            out[static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(col)] = sw_noise2d(nx, ny);
        }
    }
}

float sw_fbm2d(float x, float y, int octaves, float lacunarity, float gain) {
    float sum = 0.0f;
    float norm = 0.0f;
    float amp = 1.0f;
    float freq = 1.0f;
    for (int o = 0; o < octaves; ++o) {
        sum += amp * sw_noise2d(x * freq, y * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    // Normalising by the accumulated amplitude keeps the range at [-1, 1]
    // regardless of how many octaves were summed.
    return norm > 0.0f ? sum / norm : 0.0f;
}

void sw_fill_fbm_buffer(float* buf, int width, int height,
                        float scale, float offsetX, float offsetY,
                        int octaves, float lacunarity, float gain) {
    const float inv_scale = 1.0f / scale;
    const std::span<float> out(buf, static_cast<size_t>(width) * static_cast<size_t>(height));
    for (int row = 0; row < height; ++row) {
        for (int col = 0; col < width; ++col) {
            float nx = ((float)col + offsetX) * inv_scale;
            float ny = ((float)row + offsetY) * inv_scale;
            out[static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(col)] = sw_fbm2d(nx, ny, octaves, lacunarity, gain);
        }
    }
}

void sw_fill_particle_seeds(float* buf, int count, unsigned int seed) {
    // Same LCG as sw_seed's shuffle; the top 24 bits of the low word give a
    // uniform [0, 1) float. Mirrored bit-for-bit by the JS fallback in
    // JS fallback in src/wasm/index.ts.
    uint32_t state = seed;
    auto next_unit = [&state]() -> float {
        state = state * 1664525u + 1013904223u;
        return (float)((state >> 8) & 0xFFFFFFu) / 16777216.0f;
    };
    const std::span<float> out(buf, static_cast<size_t>(count) * 4);
    for (int i = 0; i < count; ++i) {
        const std::span<float, 4> p = out.subspan(static_cast<size_t>(i) * 4).first<4>();
        p[0] = next_unit();                    // x     [0, 1)
        p[1] = next_unit();                    // y     [0, 1)
        p[2] = 0.5f + next_unit();             // speed [0.5, 1.5)
        p[3] = next_unit() * 6.2831853f;       // phase [0, 2π)
    }
}

// Haversine formula, result in metres.
double sw_haversine(double lat1, double lon1, double lat2, double lon2) {
    static const double R = 6371000.0; // Earth radius in metres
    static const double DEG_TO_RAD = 3.14159265358979323846 / 180.0;
    double dlat = (lat2 - lat1) * DEG_TO_RAD;
    double dlon = (lon2 - lon1) * DEG_TO_RAD;
    double a = sin(dlat * 0.5) * sin(dlat * 0.5)
             + cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD)
             * sin(dlon * 0.5) * sin(dlon * 0.5);
    return R * 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
}

double sw_batch_haversine(const double* points, int count, double* out) {
    if (count < 2) return 0.0;
    const std::span<const double> pts(points, static_cast<size_t>(count) * 2);
    const std::span<double> segs(out, static_cast<size_t>(count) - 1);
    double total = 0.0;
    for (int i = 0; i < count - 1; ++i) {
        const size_t base = static_cast<size_t>(i) * 2;
        double d = sw_haversine(pts[base], pts[base + 1],
                                pts[base + 2], pts[base + 3]);
        segs[static_cast<size_t>(i)] = d;
        total += d;
    }
    return total;
}

float sw_normalize_angle(float angle) {
    return fmodf(fmodf(angle, 360.0f) + 360.0f, 360.0f);
}

float sw_signed_angle_diff(float from, float to) {
    float diff = fmodf((to - from + 180.0f), 360.0f) - 180.0f;
    // fmodf keeps the sign of the dividend, so a negative (to - from + 180)
    // lands the result below -180 (e.g. to-from = -183 yields -183 instead of
    // +177). The correction below is what the JS fallback in
    // src/wasm/index.ts and signedAngleDiff() in src/utils/navigation.ts all
    // do; without it this function silently disagreed with every other
    // implementation for negative differences.
    if (diff < -180.0f) diff += 360.0f;
    // Exactly-opposite inputs still return -180 (not +180), matching the other
    // implementations.
    return diff;
}

void sw_fill_engine_noise(float* buf, int count,
                          float rpm, float load, float speed_kmh,
                          float time_sec, float sample_rate) {
    if (count <= 0 || buf == nullptr) return;
    if (!(sample_rate > 1.0f)) sample_rate = 44100.0f;
    if (rpm < 0.0f) rpm = 0.0f;
    if (load < 0.0f) load = 0.0f;
    if (load > 1.0f) load = 1.0f;
    if (speed_kmh < 0.0f) speed_kmh = 0.0f;
    if (time_sec < 0.0f) time_sec = 0.0f;

    const float inv_sr = 1.0f / sample_rate;
    const float fund = rpm / 60.0f;
    uint32_t state = (uint32_t)floorf(time_sec * sample_rate);
    if (state == 0u) state = 1u;
    float spd = speed_kmh / 140.0f;
    if (spd > 1.0f) spd = 1.0f;

    const std::span<float> out(buf, static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        float t = time_sec + (float)i * inv_sr;
        float cycles = t * fund;
        float frac = cycles - floorf(cycles);
        float saw = frac * 2.0f - 1.0f;
        float cycles2 = t * (fund * 2.0f);
        float frac2 = cycles2 - floorf(cycles2);
        float saw2 = frac2 * 2.0f - 1.0f;
        float eng = (saw * 0.28f + saw2 * 0.11f) * (0.22f + 0.78f * load);
        state = state * 1664525u + 1013904223u;
        float n = (float)((state >> 8) & 0xFFFFFFu) / 16777216.0f;
        n = n * 2.0f - 1.0f;
        float s = eng + n * spd * 0.18f;
        if (s > 1.0f) s = 1.0f;
        if (s < -1.0f) s = -1.0f;
        out[static_cast<size_t>(i)] = s;
    }
}

void sw_fill_cabin_ir(float* buf, int count, int vehicle_type,
                      float openness, float sample_rate) {
    if (count <= 0 || buf == nullptr) return;
    if (!(sample_rate > 1.0f)) sample_rate = 44100.0f;
    if (openness < 0.0f) openness = 0.0f;
    if (openness > 1.0f) openness = 1.0f;
    if (vehicle_type < 0) vehicle_type = 0;
    if (vehicle_type >= cabin_profile_count) vehicle_type = cabin_profile_count - 1;

    const CabinProfile& p = cabin_profiles[vehicle_type];
    const std::span<float> out(buf, static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) out[static_cast<size_t>(i)] = 0.0f;

    // Direct path.
    out[0] = 1.0f;

    // Opening the roof lets reflected energy escape instead of coming back.
    const float enclosure = 1.0f - 0.75f * openness;
    const float ms_to_taps = sample_rate / 1000.0f;
    for (int r = 0; r < 3; ++r) {
        const int d = (int)(p.reflect_ms[r] * ms_to_taps);
        if (d > 0 && d < count) {
            out[static_cast<size_t>(d)] += p.reflect_gain[r] * enclosure;
        }
    }

    // Diffuse tail: the same LCG the particle seeds use, under a geometric
    // envelope. Stepping the envelope multiplicatively (rather than calling
    // expf) keeps the whole IR on exact f32 add/mul, which is what lets the
    // emcc binary, the host build and the JS twin agree bit-for-bit.
    // The seed is per-vehicle only, so toggling the roof re-colours the same
    // room instead of swapping in a different one.
    uint32_t state = (uint32_t)vehicle_type * 2654435761u + 1013904223u;
    const float tail_taps = p.tail_ms * ms_to_taps;
    const float decay = tail_taps > 1.0f ? 1.0f / tail_taps : 1.0f;
    float env = p.tail_level * enclosure;
    float prev_n = 0.0f;
    for (int i = 1; i < count; ++i) {
        state = state * 1664525u + 1013904223u;
        float n = (float)((state >> 8) & 0xFFFFFFu) / 16777216.0f;
        n = n * 2.0f - 1.0f;
        // Differencing successive noise samples removes the tail's DC: over
        // only ~128 taps a raw noise tail has a large random mean, which would
        // make the cabin's low-frequency gain a coin flip per vehicle.
        out[static_cast<size_t>(i)] += (n - prev_n) * 0.5f * env;
        prev_n = n;
        env -= env * decay;
    }

    // One-pole lowpass across the taps: cabin absorption. A larger coefficient
    // passes more high frequency, which is what an open roof sounds like.
    const float damp = p.damp_closed + (p.damp_open - p.damp_closed) * openness;
    float y = 0.0f;
    for (int i = 0; i < count; ++i) {
        y += damp * (out[static_cast<size_t>(i)] - y);
        out[static_cast<size_t>(i)] = y;
    }

    // Normalise the DC gain (the sum of the taps) to 1. The engine bed is
    // low-frequency dominated, so this is what keeps a roof toggle or a
    // vehicle swap from jumping the cabin's level: openness then only changes
    // how much high frequency survives, which is the occlusion the cabin is
    // modelling. The one-pole above has unity DC gain, so the sum is the
    // direct path plus the (enclosure-scaled) reflections and is never near
    // zero for the profiles above; the guard is for a hand-rolled profile.
    float dc = 0.0f;
    for (int i = 0; i < count; ++i) dc += out[static_cast<size_t>(i)];
    if (dc > 0.0f) {
        const float norm = 1.0f / dc;
        for (int i = 0; i < count; ++i) out[static_cast<size_t>(i)] *= norm;
    }
}

static int bt709_bin_u8(unsigned char r, unsigned char g, unsigned char b) {
    float acc = 0.2126f * static_cast<float>(r)
              + 0.7152f * static_cast<float>(g)
              + 0.0722f * static_cast<float>(b);
    int bin = static_cast<int>(floorf(acc + 0.5f));
    if (bin < 0) bin = 0;
    if (bin > 255) bin = 255;
    return bin;
}

void sw_luma_histogram_bt709(const unsigned char* rgba, int width, int height,
                             unsigned int* bins) {
    if (bins == nullptr) return;
    const std::span<unsigned int, 256> bin_span(bins, 256);
    for (size_t i = 0; i < 256; ++i) bin_span[i] = 0u;
    if (width <= 0 || height <= 0 || rgba == nullptr) return;
    const int count = width * height;
    const std::span<const unsigned char> px(rgba, static_cast<size_t>(count) * 4u);
    for (int i = 0; i < count; ++i) {
        const size_t base = static_cast<size_t>(i) * 4u;
        int bin = bt709_bin_u8(px[base], px[base + 1], px[base + 2]);
        bin_span[static_cast<size_t>(bin)] += 1u;
    }
}

void sw_reduce_luma_bt709(const unsigned char* rgba, int width, int height,
                          float* out3) {
    if (out3 == nullptr) return;
    const std::span<float, 3> out(out3, 3);
    out[0] = 0.0f;
    out[1] = 0.0f;
    out[2] = 0.0f;
    if (width <= 0 || height <= 0 || rgba == nullptr) return;
    const int count = width * height;
    const std::span<const unsigned char> px(rgba, static_cast<size_t>(count) * 4u);
    float sum = 0.0f;
    float mn = 1.0f;
    float mx = 0.0f;
    for (int i = 0; i < count; ++i) {
        const size_t base = static_cast<size_t>(i) * 4u;
        float y = (0.2126f * static_cast<float>(px[base])
                 + 0.7152f * static_cast<float>(px[base + 1])
                 + 0.0722f * static_cast<float>(px[base + 2])) / 255.0f;
        sum += y;
        if (y < mn) mn = y;
        if (y > mx) mx = y;
    }
    out[0] = sum / static_cast<float>(count);
    out[1] = mn;
    out[2] = mx;
}

void sw_downsample_2d(const unsigned char* src, int src_w, int src_h,
                      unsigned char* dst, int dst_w, int dst_h) {
    if (src == nullptr || dst == nullptr) return;
    if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return;
    const std::span<const unsigned char> in(
        src, static_cast<size_t>(src_w) * static_cast<size_t>(src_h) * 4u);
    const std::span<unsigned char> out(
        dst, static_cast<size_t>(dst_w) * static_cast<size_t>(dst_h) * 4u);
    for (int dy = 0; dy < dst_h; ++dy) {
        int y0 = (dy * src_h) / dst_h;
        int y1 = ((dy + 1) * src_h) / dst_h;
        if (y1 <= y0) y1 = y0 + 1;
        if (y1 > src_h) y1 = src_h;
        for (int dx = 0; dx < dst_w; ++dx) {
            int x0 = (dx * src_w) / dst_w;
            int x1 = ((dx + 1) * src_w) / dst_w;
            if (x1 <= x0) x1 = x0 + 1;
            if (x1 > src_w) x1 = src_w;
            int sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
            for (int y = y0; y < y1; ++y) {
                for (int x = x0; x < x1; ++x) {
                    const size_t base = (static_cast<size_t>(y) * static_cast<size_t>(src_w)
                                          + static_cast<size_t>(x)) * 4u;
                    sr += static_cast<int>(in[base]);
                    sg += static_cast<int>(in[base + 1]);
                    sb += static_cast<int>(in[base + 2]);
                    sa += static_cast<int>(in[base + 3]);
                    n += 1;
                }
            }
            const size_t dbase = (static_cast<size_t>(dy) * static_cast<size_t>(dst_w)
                                  + static_cast<size_t>(dx)) * 4u;
            if (n <= 0) {
                out[dbase] = 0; out[dbase + 1] = 0; out[dbase + 2] = 0; out[dbase + 3] = 255;
            } else {
                out[dbase]     = static_cast<unsigned char>(sr / n);
                out[dbase + 1] = static_cast<unsigned char>(sg / n);
                out[dbase + 2] = static_cast<unsigned char>(sb / n);
                out[dbase + 3] = static_cast<unsigned char>(sa / n);
            }
        }
    }
}

} // extern "C"
