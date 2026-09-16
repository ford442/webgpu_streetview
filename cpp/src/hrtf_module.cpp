/**
 * hrtf_module.cpp
 * Heading-relative binaural shadow model for the wind/rain audio bed
 * (src/effects/WindAudio.ts). Separate translation unit from
 * noise_module.cpp, which already covers six unrelated concerns (noise,
 * particles, geodesy, angles, engine PCM, cabin IR, luma/downsample) — this
 * doesn't get folded in as a seventh.
 *
 * This is not a measured HRTF (no KEMAR table, nothing under cpp/data/) — it
 * is an analytic interaural time/level model: the near ear gets an undelayed
 * unit impulse, the far ear gets a delayed, attenuated impulse smeared with
 * the same one-pole low-pass idiom sw_fill_cabin_ir uses for head-shadow
 * high-frequency loss. At azimuth 0 the two ears are identical.
 *
 * Trig-free by design: the ITD term below is a smooth S-curve stand-in for
 * the sine term in a physical (Woodworth) ITD model, not sinf itself. That
 * keeps this function on exact add/sub/mul/div arithmetic — the same
 * constraint sw_fill_cabin_ir and sw_fill_engine_noise are under — so the
 * emcc binary, the host build and the JS twin agree to the last f32 bit and
 * the golden tests can assert bit-exact equality instead of a tolerance (the
 * way sw_haversine's sin/cos/atan2 path has to).
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include <cstddef>
#include <span>

namespace {

/** Max interaural time difference (seconds) — roughly the physical human max. */
constexpr float kMaxItdSeconds = 6.6e-4f;

/** Max amplitude cut applied to the far ear's direct tap, at |azimuth| = 90. */
constexpr float kMaxFarGainCut = 0.35f;

/**
 * One-pole "damp" coefficient floor for the far ear at |azimuth| = 90 — same
 * coefficient sw_fill_cabin_ir uses (a larger value passes more high
 * frequency). At azimuth 0 damp is 1 (no filtering — the near/far split
 * doesn't exist yet), shrinking toward this floor as the source moves
 * off-axis, modelling more head-shadow high-frequency loss.
 */
constexpr float kFarEarDampFloor = 0.28f;

} // namespace

extern "C" {

void sw_fill_hrtf(float* left, float* right, int count,
                  float azimuth_deg, float sample_rate) {
    if (count <= 0 || left == nullptr || right == nullptr) return;
    if (!(sample_rate > 1.0f)) sample_rate = 44100.0f;
    if (azimuth_deg > 90.0f) azimuth_deg = 90.0f;
    else if (azimuth_deg < -90.0f) azimuth_deg = -90.0f;

    const std::span<float> l(left, static_cast<size_t>(count));
    const std::span<float> r(right, static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        l[static_cast<size_t>(i)] = 0.0f;
        r[static_cast<size_t>(i)] = 0.0f;
    }

    // Trig-free stand-in for the sine term in a physical (Woodworth) ITD
    // model: a smooth S-curve that saturates toward +-1 at the +-90 degree
    // ends, the same shape family as sin(theta) over that range, without
    // calling sinf (see file header for why that matters here).
    const float ratio = azimuth_deg / 90.0f;
    const float abs_ratio = ratio < 0.0f ? -ratio : ratio;
    const float shaped = ratio * (2.0f - abs_ratio);
    const float abs_shaped = shaped < 0.0f ? -shaped : shaped;

    int delay = (int)(kMaxItdSeconds * sample_rate * abs_shaped + 0.5f);
    if (delay > count - 1) delay = count - 1;
    if (delay < 0) delay = 0;

    const float far_gain = 1.0f - kMaxFarGainCut * abs_shaped;
    const float damp = 1.0f - (1.0f - kFarEarDampFloor) * abs_shaped;

    // Positive azimuth = source toward the right ear: right hears it first
    // (undelayed), left sits in the acoustic shadow. Negative azimuth mirrors
    // this exactly — abs_shaped, far_gain and damp are all even in azimuth,
    // so swapping which span is "near" vs "far" is the only difference.
    const bool right_is_near = shaped >= 0.0f;
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
