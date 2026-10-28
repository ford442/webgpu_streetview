/**
 * hrtf_module.cpp
 * Heading-relative binaural shadow model for the wind/rain audio bed
 * (src/effects/WindAudio.ts) — the hrtf domain of the one-translation-unit-
 * per-domain numeric layer (noise, geodesy, audio, hrtf, luma, cabin dsp).
 * The cabin engine (cabin_dsp_module.cpp) places its sources with the same
 * coefficients: they live in sv_audio::hrtf_shadow (audio_kernels.h).
 *
 * This is not a measured HRTF (no KEMAR table, nothing under cpp/data/) — it
 * is an analytic interaural time/level model: the near ear gets an undelayed
 * unit impulse, the far ear gets a delayed, attenuated impulse smeared with
 * the same one-pole low-pass idiom sw_fill_cabin_ir uses for head-shadow
 * high-frequency loss. At azimuth 0 the two ears are identical.
 *
 * Trig-free by design: the ITD term is a smooth S-curve stand-in for
 * the sine term in a physical (Woodworth) ITD model, not sinf itself. That
 * keeps this function on exact add/sub/mul/div arithmetic — the same
 * constraint sw_fill_cabin_ir is under — so the
 * emcc binary, the host build and the JS twin agree to the last f32 bit and
 * the golden tests can assert bit-exact equality instead of a tolerance (the
 * way sw_haversine's sin/cos/atan2 path has to).
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview/abi.h"
#include "streetview/audio_kernels.h"
#include <cstddef>
#include <span>

extern "C" {

void sw_fill_hrtf(float* left, float* right, int count,
                  float azimuth_deg, float sample_rate) {
    if (count <= 0 || left == nullptr || right == nullptr) return;
    if (!(sample_rate > 1.0f)) sample_rate = 44100.0f;
    const std::span<float> l(left, static_cast<size_t>(count));
    const std::span<float> r(right, static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        l[static_cast<size_t>(i)] = 0.0f;
        r[static_cast<size_t>(i)] = 0.0f;
    }

    // The coefficients (and the trig-free ITD S-curve behind them) live in
    // audio_kernels.h so the worklet engine (cabin_dsp_module.cpp) places its
    // sources with exactly this model.
    const sv_audio::HrtfShadow shadow = sv_audio::hrtf_shadow(azimuth_deg, sample_rate);
    int delay = shadow.delay;
    if (delay > count - 1) delay = count - 1;
    if (delay < 0) delay = 0;

    const float far_gain = shadow.far_gain;
    const float damp = shadow.damp;

    // Positive azimuth = source toward the right ear: right hears it first
    // (undelayed), left sits in the acoustic shadow. Negative azimuth mirrors
    // this exactly — the delay, far_gain and damp are all even in azimuth,
    // so swapping which span is "near" vs "far" is the only difference.
    const bool right_is_near = shadow.right_is_near;
    const std::span<float> near_ear = right_is_near ? r : l;
    const std::span<float> far_ear = right_is_near ? l : r;

    near_ear[0] = 1.0f;

    // Direct tap on the far ear, then a one-pole smear forward from it (the
    // same idiom sw_fill_cabin_ir uses for its absorption filter). At
    // azimuth 0, damp == 1 and delay == 0, so this collapses to an
    // undelayed, unfiltered unit impulse — identical to the near ear.
    far_ear[static_cast<size_t>(delay)] = far_gain;
    float y = 0.0f;
    for (int i = delay; i < count; ++i) {
        const float x = far_ear[static_cast<size_t>(i)];
        y += damp * (x - y);
        far_ear[static_cast<size_t>(i)] = y;
    }
}

} // extern "C"
