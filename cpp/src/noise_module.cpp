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
#include <cstring>
#include <stdint.h>

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
    return x < xi ? xi - 1 : xi;
}

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
    for (int row = 0; row < height; ++row) {
        for (int col = 0; col < width; ++col) {
            float nx = ((float)col + offsetX) * inv_scale;
            float ny = ((float)row + offsetY) * inv_scale;
            buf[row * width + col] = sw_noise2d(nx, ny);
        }
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

float sw_normalize_angle(float angle) {
    return fmodf(fmodf(angle, 360.0f) + 360.0f, 360.0f);
}

float sw_signed_angle_diff(float from, float to) {
    float diff = fmodf((to - from + 180.0f), 360.0f) - 180.0f;
    // fmod can return -180 when the inputs are exactly opposite; keep as -180
    // per the convention used throughout the codebase (matches navigation.ts).
    return diff;
}

} // extern "C"
