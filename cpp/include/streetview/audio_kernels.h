#pragma once
/**
 * streetview/audio_kernels.h
 * Internal (not exported) scalar building blocks shared by the audio domains:
 * audio_module.cpp (fill_engine_noise / fill_cabin_ir), hrtf_module.cpp
 * (fill_hrtf) and cabin_dsp_module.cpp (the stateful dsp_* engine that runs
 * inside the AudioWorklet).
 *
 * They live in one header so the worklet engine is not a second copy of the
 * engine tone or the head-shadow model: `dsp_render` and the cold kernels use
 * the same expressions, op for op, and the goldens pin both. Everything here
 * stays on add/sub/mul/div (plus floor on the f64 phase), so the emcc binary,
 * the host build and the JS twins in src/wasm/ agree to the last f32 bit.
 */

#include <cmath>
#include <cstdint>

namespace sv_audio {

/**
 * Integer avalanche hash (Wellons' "lowbias32"): consecutive inputs give
 * uncorrelated outputs, which a bare LCG step of the index would not. Every
 * noise source in the audio domains is a hash of a sample counter, so a block
 * of N samples is the same bits however it is split.
 */
inline uint32_t hash_u32(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

/** Top 24 bits of a hash as a uniform float in [0, 1) — exact in f32. */
inline float hash_unit(uint32_t h) {
    return static_cast<float>((h >> 8) & 0xFFFFFFu) / 16777216.0f;
}

/**
 * The engine voice of sw_fill_engine_noise: a sawtooth at the firing
 * fundamental plus one an octave up, scaled by the load gain
 * (0.22 + 0.78 * load). `phase` is in fundamental cycles, [0, 1).
 */
inline float engine_tone(double phase, float load_gain) {
    const double cycles2 = phase * 2.0;
    const double frac2 = cycles2 - std::floor(cycles2);
    const float saw = static_cast<float>(phase) * 2.0f - 1.0f;
    const float saw2 = static_cast<float>(frac2) * 2.0f - 1.0f;
    return (saw * 0.28f + saw2 * 0.11f) * load_gain;
}

/** Max interaural time difference (seconds) — roughly the physical human max. */
constexpr float kMaxItdSeconds = 6.6e-4f;

/** Max amplitude cut applied to the far ear's direct tap, at |azimuth| = 90. */
constexpr float kMaxFarGainCut = 0.35f;

/**
 * One-pole "damp" coefficient floor for the far ear at |azimuth| = 90 — the
 * same coefficient family sw_fill_cabin_ir uses (a larger value passes more
 * high frequency). At azimuth 0 damp is 1 (no filtering).
 */
constexpr float kFarEarDampFloor = 0.28f;

/**
 * The heading-relative head-shadow coefficients behind sw_fill_hrtf: the far
 * ear hears the source `delay` samples late, `far_gain` quieter and through a
 * one-pole low-pass with coefficient `damp`. The near ear hears it unchanged.
 * See hrtf_module.cpp for the model; `delay` is not yet clamped to a buffer.
 */
struct HrtfShadow {
    int delay;
    float far_gain;
    float damp;
    bool right_is_near;
};

/** `sample_rate` must already be sanitised (> 1). */
inline HrtfShadow hrtf_shadow(float azimuth_deg, float sample_rate) {
    if (azimuth_deg > 90.0f)
        azimuth_deg = 90.0f;
    else if (azimuth_deg < -90.0f)
        azimuth_deg = -90.0f;

    // Trig-free stand-in for the sine term in a physical (Woodworth) ITD
    // model: a smooth S-curve that saturates toward +-1 at the +-90 degree
    // ends, the same shape family as sin(theta) over that range.
    const float ratio = azimuth_deg / 90.0f;
    const float abs_ratio = ratio < 0.0f ? -ratio : ratio;
    const float shaped = ratio * (2.0f - abs_ratio);
    const float abs_shaped = shaped < 0.0f ? -shaped : shaped;

    HrtfShadow s{};
    // Truncating x + 0.5f (x >= 0) is golden-pinned: lround differs where the
    // f32 add itself rounds up (0.49999997f + 0.5f == 1.0f).
    // NOLINTNEXTLINE(bugprone-incorrect-roundings)
    s.delay = static_cast<int>(kMaxItdSeconds * sample_rate * abs_shaped + 0.5f);
    s.far_gain = 1.0f - kMaxFarGainCut * abs_shaped;
    s.damp = 1.0f - (1.0f - kFarEarDampFloor) * abs_shaped;
    s.right_is_near = shaped >= 0.0f;
    return s;
}

} // namespace sv_audio
