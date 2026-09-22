/**
 * audio_module.cpp
 * Engine PCM and cabin impulse responses for the WebGPU StreetView WASM module.
 *
 * Split out of noise_module.cpp so the numeric layer has one translation unit
 * per domain; the binaural shadow (sw_fill_hrtf) already lives in
 * hrtf_module.cpp. The exported ABI is unchanged — these are the same `sw_*`
 * definitions, in their own TU.
 *
 * Both kernels stay on add/sub/mul/div plus an integer LCG (no transcendentals
 * in the cabin IR) so the emcc binary, the host build and the JS twin in
 * src/wasm/jsFallback.ts agree to the last f32 bit.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

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

} // extern "C"
