/**
 * noise_module.cpp
 * Gradient noise and particle seeds for the WebGPU StreetView WASM module.
 *
 * Implements a classic Perlin gradient noise (2D), the fBm stack over it, and
 * the deterministic particle spawn seeds the weather system uses.
 *
 * This TU is noise and particles only. The rest of the numeric layer lives
 * next to it, one translation unit per domain:
 *   geodesy_module.cpp  haversine / angles / offset_latlng
 *   audio_module.cpp    engine PCM / cabin IR
 *   hrtf_module.cpp     binaural shadow
 *   luma_module.cpp     Rec.709 histogram / reduce / downsample
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
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
    // src/wasm/jsFallback.ts.
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

} // extern "C"
