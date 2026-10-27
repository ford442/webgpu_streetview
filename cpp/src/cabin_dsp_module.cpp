/**
 * cabin_dsp_module.cpp
 * The cabin audio engine: the whole car bed rendered at audio rate inside the
 * AudioWorklet (src/car/audio/cabinWorkletSource.ts instantiates this binary
 * there and calls dsp_render straight into the output channels). The cabin
 * domain of the one-translation-unit-per-domain numeric layer.
 *
 * Signal flow, per sample:
 *
 *   engine (rpm/load, f64 phase) ─┐
 *   road  L/R (rumble + wet hiss) ┼─► body occlusion (one-pole, openness) ─┐
 *   wind  (band noise, HRTF -55°) ┘                                        │
 *   rain on the roof L/R (granular drops + hiss) ──────────────────────────┤
 *   wiper thump (resonator) ───────────────────────────────────────────────┤
 *   radio L/R (HRTF -30° / +30°, the dash speakers) ───────────────────────┤
 *                                                                          ▼
 *            cabin FIR (uniformly partitioned, 128-tap partitions, ≤ 4096 taps)
 *                                  ─► DC blocker ─► clamp ─► out L/R
 *
 * The convolution and the head shadow are both linear and time-invariant, so
 * placing each source first and then running one stereo cabin FIR is the
 * same room as convolving every source, at a fraction of the cost.
 *
 * Determinism contract (what the goldens pin):
 *   - Only add/sub/mul/div, comparisons, and floor on the f64 phases. No
 *     transcendentals: filter coefficients use 2*pi*f/fs (clamped to 1) and
 *     the thump resonator a Taylor cosine.
 *   - Noise is a hash of a 32-bit sample counter (sv_audio::hash_u32), so the
 *     output does not depend on how the caller splits blocks.
 *   - The FIR dot product has one canonical summation order: four lane
 *     accumulators over j mod 4 in increasing j, then (a0 + a1) + (a2 + a3).
 *     The scalar build spells that out; the SIMD build (-msimd128) does the
 *     same adds in f32x4 lanes. WASM SIMD has no FMA and we never pass
 *     -ffast-math, so both binaries and the JS twin (src/wasm/cabinDspTwin.ts)
 *     agree to the last bit.
 *
 * Memory: dsp_create mallocs the state from the module's own heap (the same
 * allocator behind the loader's scratch arena, above the shadow stack). There
 * are no globals; every instance is independent. dsp_render never allocates.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include "audio_kernels.h"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <span>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

namespace {

using sv_audio::hash_u32;
using sv_audio::hash_unit;

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------
/** FIR partition == the Web Audio render quantum. */
constexpr int kQuantum = 128;
/** Longest IR dsp_set_ir accepts (85 ms at 48 kHz). */
constexpr int kMaxIrTaps = 4096;
/** History slot of the first sample of the current block. */
constexpr int kHistoryOffset = kMaxIrTaps - 1;
constexpr int kHistoryLen = kHistoryOffset + kQuantum;
// The worklet (CABIN_QUANTUM in src/car/audio/cabinWorkletSource.ts) and the
// loader's createCabinDsp pack their I/O block as 4 x 128 floats + the IR.
static_assert(kQuantum == 128, "the Web Audio render quantum; the TS I/O blocks are sized from it");
static_assert(kMaxIrTaps % kQuantum == 0, "IRs pad to whole partitions");
/** IR swaps crossfade over two quanta (~5 ms) instead of clicking. */
constexpr int kXfadeFrames = 256;
constexpr float kInvXfadeFrames = 1.0f / 256.0f;
/** Power of two above the longest ITD (127 taps at 192 kHz). */
constexpr int kItdRing = 256;
constexpr int kItdMask = kItdRing - 1;

// ---------------------------------------------------------------------------
// Voice constants (levels are linear, times seconds, frequencies Hz)
// ---------------------------------------------------------------------------
constexpr float kTwoPi = 6.2831855f;
constexpr float kSmoothSeconds = 0.04f;
constexpr float kInvSpeedFullMps = 0.025f;   // 40 m/s = full road / wind noise
constexpr float kEngineGain = 0.42f;
constexpr float kRumbleHz = 110.0f;
constexpr float kRumbleGain = 2.6f;
constexpr float kHissSplitHz = 2200.0f;      // wet hiss = white minus this low-pass
constexpr float kDryHissGain = 0.02f;
constexpr float kWetHissGain = 0.12f;
constexpr float kSprayGain = 1.4f;           // wet-arch spray: the rumble..hiss band
constexpr float kWindLoHz = 250.0f;          // band top at no wind ...
constexpr float kWindHiHz = 1600.0f;         // ... and at full wind
constexpr float kWindBaseHz = 90.0f;         // band bottom
constexpr float kWindGain = 0.9f;
constexpr float kGustHz = 0.6f;
constexpr float kGustScale = 18.0f;
constexpr float kDropRatePerSec = 1400.0f;   // at rain = 1
constexpr float kDropDecaySeconds = 0.0025f;
constexpr float kDrumHz = 400.0f;
constexpr float kDrumGain = 0.55f;
constexpr float kTickGain = 0.10f;
constexpr float kRainHissHz = 5000.0f;
constexpr float kRainHissGain = 0.05f;
constexpr float kWiperRainMin = 0.02f;
constexpr float kWiperBaseHz = 0.6f;         // sweeps per second, light rain ...
constexpr float kWiperRainHz = 0.6f;         // ... plus this much at rain = 1
constexpr float kThumpHz = 55.0f;
constexpr float kThumpDecaySeconds = 0.06f;
constexpr float kThumpGain = 0.25f;
constexpr float kOccClosedHz = 700.0f;       // body occlusion, roof sealed ...
constexpr float kOccOpenHz = 6000.0f;        // ... and fully open
constexpr float kDcHz = 20.0f;
constexpr float kInv255 = 1.0f / 255.0f;
constexpr float kInv24 = 1.0f / 24.0f;
constexpr float kInputLimit = 8.0f;          // radio samples outside +-8 (or NaN) are dropped
constexpr float kWindAzimuth = -55.0f;       // the driver's window
constexpr float kSpeakerAzimuth = 30.0f;     // dash speakers at +-30 degrees

// Per-stream hash seeds (golden-ratio multiples, so streams never coincide).
constexpr uint32_t kSeedRoadL = 0x9E3779B9u;
constexpr uint32_t kSeedRoadR = 0x3C6EF372u;
constexpr uint32_t kSeedWind = 0xDAA66D2Bu;
constexpr uint32_t kSeedGust = 0x78DDE6E4u;
constexpr uint32_t kSeedDrop = 0x1715609Du;
constexpr uint32_t kSeedTick = 0xB54CDA56u;
constexpr uint32_t kSeedRainL = 0x5384540Fu;
constexpr uint32_t kSeedRainR = 0xF1BBCDC8u;
constexpr uint32_t kSeedPan = 0x8FF34781u;

enum Param : int {
    kRpm,
    kLoad,
    kSpeed,
    kOpen,
    kWet,
    kRain,
    kWind,
    kRadio,
    kVehEngine,
    kVehRoad,
    kVehWind,
    kParamCount
};

/** Per-vehicle voicing, in CABIN_IR_VEHICLE_INDEX order (src/car/audio/cabinIr.ts). */
struct VehicleVoice {
    float engine;
    float road;
    float wind;
};

constexpr VehicleVoice kVehicleVoices[] = {
    {1.00f, 1.00f, 1.00f},  // sedan
    {1.05f, 1.10f, 1.30f},  // convertible — thin soft top
    {0.90f, 1.20f, 0.90f},  // science-lab — boxy, loud tyres
    {0.60f, 0.60f, 0.65f},  // limousine — heavy insulation
    {1.35f, 1.05f, 1.10f},  // cortianics — sport exhaust
};
constexpr int kVehicleCount = static_cast<int>(sizeof(kVehicleVoices) / sizeof(kVehicleVoices[0]));

/** One source placed by the sv_audio head-shadow model (same as fill_hrtf). */
struct HrtfVoice {
    int delay;
    float far_gain;
    float damp;
    int right_is_near;
    int pos;
    float far_y;
    float ring[kItdRing];
};

struct DspState {
    float sample_rate;
    double inv_sample_rate;
    float smooth_k;
    float target[kParamCount];
    float current[kParamCount];
    int wipers;

    // Coefficients, fixed per sample rate.
    float rumble_a, hiss_a, wind_a_lo, wind_a_hi, wind_base_a, gust_a;
    float drop_decay, drop_p_scale, drum_a, rain_hiss_a;
    float occ_a_closed, occ_a_open, dc_r;
    float thump_c1, thump_c2, thump_kick;

    // Running state.
    uint32_t sample;
    double engine_phase;
    double wiper_phase;
    float rumble_l, rumble_r, hiss_lp_l, hiss_lp_r;
    float wind_lp1, wind_lp2, gust;
    float drop_env, drop_pan, drum_lp, rain_lp_l, rain_lp_r;
    float thump_y1, thump_y2;
    float occ_l, occ_r;
    float dc_x_l, dc_y_l, dc_x_r, dc_y_r;
    HrtfVoice wind_voice, radio_l_voice, radio_r_voice;

    // Cabin FIR: IRs are stored time-reversed and zero-padded to whole
    // partitions, so y[n] is one contiguous dot product against the history.
    int ir_cur;
    int ir_len;
    int prev_ir_len;
    int xfade_pos;
    float ir[2][kMaxIrTaps];
    float hist_l[kHistoryLen];
    float hist_r[kHistoryLen];
    // FIR output of the current (wet) and outgoing (old) IR for one block.
    float wet_l[kQuantum], wet_r[kQuantum], old_l[kQuantum], old_r[kQuantum];
};

inline float clampf(float v, float lo, float hi) {
    if (!(v >= lo)) return lo;  // also catches NaN
    if (v > hi) return hi;
    return v;
}

/** One-pole coefficient for a corner frequency: 2*pi*f/fs, clamped to 1. */
inline float pole_coeff(float hz, float sample_rate) {
    const float a = kTwoPi * hz / sample_rate;
    return a > 1.0f ? 1.0f : a;
}

inline float white(uint32_t base, uint32_t seed) {
    return hash_unit(hash_u32(base ^ seed)) * 2.0f - 1.0f;
}

void hrtf_voice_init(HrtfVoice& v, float azimuth_deg, float sample_rate) {
    const sv_audio::HrtfShadow s = sv_audio::hrtf_shadow(azimuth_deg, sample_rate);
    v.delay = s.delay < 0 ? 0 : (s.delay > kItdMask ? kItdMask : s.delay);
    v.far_gain = s.far_gain;
    v.damp = s.damp;
    v.right_is_near = s.right_is_near ? 1 : 0;
    v.pos = 0;
    v.far_y = 0.0f;
}

/** Push one sample; adds the near ear's and the far ear's signal to l / r. */
inline void hrtf_voice_step(HrtfVoice& v, float x, float& l, float& r) {
    v.ring[v.pos] = x;
    // Ring indices wrap through unsigned (pos - delay is negative near 0).
    const unsigned mask = static_cast<unsigned>(kItdMask);
    const float delayed = v.ring[(static_cast<unsigned>(v.pos) - static_cast<unsigned>(v.delay)) & mask];
    v.pos = static_cast<int>((static_cast<unsigned>(v.pos) + 1u) & mask);
    v.far_y += v.damp * ((v.far_gain * delayed) - v.far_y);
    if (v.right_is_near != 0) {
        r += x;
        l += v.far_y;
    } else {
        l += x;
        r += v.far_y;
    }
}

#ifdef __wasm_simd128__
inline float lane_sum(v128_t acc) {
    return (wasm_f32x4_extract_lane(acc, 0) + wasm_f32x4_extract_lane(acc, 1))
         + (wasm_f32x4_extract_lane(acc, 2) + wasm_f32x4_extract_lane(acc, 3));
}
#endif

/**
 * The canonical FIR dot product (see the file header). `n` is a multiple of
 * 4 — IRs are padded to whole 128-tap partitions.
 */
inline float fir_dot(const float* hr, const float* x, int n) {
#ifdef __wasm_simd128__
    v128_t acc = wasm_f32x4_splat(0.0f);
    for (int j = 0; j < n; j += 4) {
        acc = wasm_f32x4_add(acc, wasm_f32x4_mul(wasm_v128_load(hr + j), wasm_v128_load(x + j)));
    }
    return lane_sum(acc);
#else
    float a0 = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
    float a3 = 0.0f;
    for (int j = 0; j < n; j += 4) {
        a0 += hr[j] * x[j];
        a1 += hr[j + 1] * x[j + 1];
        a2 += hr[j + 2] * x[j + 2];
        a3 += hr[j + 3] * x[j + 3];
    }
    return (a0 + a1) + (a2 + a3);
#endif
}

/**
 * fir_dot for four consecutive outputs (x, x + 1, x + 2, x + 3). Each output
 * keeps its own four-lane accumulator, so the sums are bit-identical to four
 * fir_dot calls; the SIMD build just loads each IR vector once instead of
 * four times.
 */
inline void fir_dot4(const float* hr, const float* x, int n, float out[4]) {
#ifdef __wasm_simd128__
    v128_t a0 = wasm_f32x4_splat(0.0f);
    v128_t a1 = a0;
    v128_t a2 = a0;
    v128_t a3 = a0;
    for (int j = 0; j < n; j += 4) {
        const v128_t h = wasm_v128_load(hr + j);
        a0 = wasm_f32x4_add(a0, wasm_f32x4_mul(h, wasm_v128_load(x + j)));
        a1 = wasm_f32x4_add(a1, wasm_f32x4_mul(h, wasm_v128_load(x + j + 1)));
        a2 = wasm_f32x4_add(a2, wasm_f32x4_mul(h, wasm_v128_load(x + j + 2)));
        a3 = wasm_f32x4_add(a3, wasm_f32x4_mul(h, wasm_v128_load(x + j + 3)));
    }
    out[0] = lane_sum(a0);
    out[1] = lane_sum(a1);
    out[2] = lane_sum(a2);
    out[3] = lane_sum(a3);
#else
    for (int m = 0; m < 4; ++m) out[m] = fir_dot(hr, x + m, n);
#endif
}

/** The cabin FIR over one block of `frames` outputs into y. */
inline void fir_block(const float* hr, const float* x, int len, int frames, float* y) {
    int n = 0;
    for (; n + 4 <= frames; n += 4) fir_dot4(hr, x + n, len, y + n);
    for (; n < frames; ++n) y[n] = fir_dot(hr, x + n, len);
}

/**
 * Render one chunk of at most a quantum (`frames`). An empty input span is
 * silence and an empty output span is discarded — the extern "C" nullptrs.
 */
void render_block(DspState& s, std::span<const float> in_l, std::span<const float> in_r,
                  std::span<float> out_l, std::span<float> out_r, int frames) {
    const float k = s.smooth_k;
    for (int i = 0; i < frames; ++i) {
        // Parameter smoothing: one pole per parameter, per sample, so the
        // main thread can post at any cadence without zipper noise.
        for (int p = 0; p < kParamCount; ++p) {
            s.current[p] += k * (s.target[p] - s.current[p]);
        }
        const float* c = s.current;
        const float open = c[kOpen];
        const float rain = c[kRain];

        // --- engine ------------------------------------------------------
        const float fund = c[kRpm] / 60.0f;
        const float eng = sv_audio::engine_tone(s.engine_phase, 0.22f + 0.78f * c[kLoad])
                        * (kEngineGain * c[kVehEngine]);
        s.engine_phase += static_cast<double>(fund) * s.inv_sample_rate;
        s.engine_phase -= std::floor(s.engine_phase);

        // --- noise streams ----------------------------------------------
        const uint32_t base = hash_u32(s.sample);
        const float w_road_l = white(base, kSeedRoadL);
        const float w_road_r = white(base, kSeedRoadR);
        const float w_wind = white(base, kSeedWind);
        const float w_gust = white(base, kSeedGust);
        const float w_tick = white(base, kSeedTick);
        const float w_rain_l = white(base, kSeedRainL);
        const float w_rain_r = white(base, kSeedRainR);
        const uint32_t h_drop = hash_u32(base ^ kSeedDrop);

        // --- road: tyre rumble, hiss, and the spray a wet road adds -------
        float spd = c[kSpeed] * kInvSpeedFullMps;
        if (spd > 1.0f) spd = 1.0f;
        const float road_gain = (spd * (0.35f + 0.65f * spd)) * c[kVehRoad];
        const float hiss_gain = kDryHissGain + kWetHissGain * c[kWet];
        const float spray_gain = kSprayGain * c[kWet];
        s.rumble_l += s.rumble_a * (w_road_l - s.rumble_l);
        s.rumble_r += s.rumble_a * (w_road_r - s.rumble_r);
        s.hiss_lp_l += s.hiss_a * (w_road_l - s.hiss_lp_l);
        s.hiss_lp_r += s.hiss_a * (w_road_r - s.hiss_lp_r);
        // Spray is the band between the rumble and hiss splits: mid
        // frequencies, which (unlike the hiss) survive a sealed cabin.
        const float road_l = (((s.rumble_l * kRumbleGain) + ((w_road_l - s.hiss_lp_l) * hiss_gain))
                             + ((s.hiss_lp_l - s.rumble_l) * spray_gain)) * road_gain;
        const float road_r = (((s.rumble_r * kRumbleGain) + ((w_road_r - s.hiss_lp_r) * hiss_gain))
                             + ((s.hiss_lp_r - s.rumble_r) * spray_gain)) * road_gain;

        // --- wind: a band of noise that widens and rises with airspeed ----
        float w = (c[kSpeed] + 0.5f * c[kWind]) * kInvSpeedFullMps;
        if (w > 1.0f) w = 1.0f;
        const float wind_a = s.wind_a_lo + (s.wind_a_hi - s.wind_a_lo) * w;
        s.wind_lp1 += wind_a * (w_wind - s.wind_lp1);
        s.wind_lp2 += s.wind_base_a * (s.wind_lp1 - s.wind_lp2);
        s.gust += s.gust_a * (w_gust - s.gust);
        const float gust_amp = clampf(0.75f + s.gust * kGustScale, 0.25f, 1.25f);
        const float wind_src = (((s.wind_lp1 - s.wind_lp2) * ((w * w) * (0.2f + 0.8f * open)))
                               * (kWindGain * c[kVehWind])) * gust_amp;

        // --- rain on the roof: granular drops + diffuse hiss -------------
        if (hash_unit(h_drop) < rain * s.drop_p_scale) {
            const float amp = 0.4f + 0.6f * (static_cast<float>(h_drop & 0xFFu) * kInv255);
            if (amp > s.drop_env) s.drop_env = amp;
            s.drop_pan = 0.2f + 0.6f * hash_unit(hash_u32(base ^ kSeedPan));
        }
        const float tick = s.drop_env * w_tick;
        s.drop_env *= s.drop_decay;
        s.drum_lp += s.drum_a * (tick - s.drum_lp);
        s.rain_lp_l += s.rain_hiss_a * (w_rain_l - s.rain_lp_l);
        s.rain_lp_r += s.rain_hiss_a * (w_rain_r - s.rain_lp_r);
        // A sealed roof drums; an open one lets the splatter and hiss in.
        const float drop = (s.drum_lp * (kDrumGain * (1.0f - open)))
                         + (tick * (kTickGain * (0.3f + 0.7f * open)));
        const float hiss_amp = rain * (kRainHissGain * (0.4f + 0.6f * open));
        const float rain_l = (drop * (1.0f - s.drop_pan)) + (s.rain_lp_l * hiss_amp);
        const float rain_r = (drop * s.drop_pan) + (s.rain_lp_r * hiss_amp);

        // --- wiper thump at each end of the sweep ------------------------
        float thump_in = 0.0f;
        if (s.wipers != 0 && rain > kWiperRainMin) {
            const double before = s.wiper_phase;
            s.wiper_phase += static_cast<double>(kWiperBaseHz + kWiperRainHz * rain) * s.inv_sample_rate;
            if (before < 0.5 && s.wiper_phase >= 0.5) thump_in = s.thump_kick;
            if (s.wiper_phase >= 1.0) {
                s.wiper_phase -= 1.0;
                thump_in = s.thump_kick;
            }
        }
        const float thump = ((s.thump_c1 * s.thump_y1) - (s.thump_c2 * s.thump_y2)) + thump_in;
        s.thump_y2 = s.thump_y1;
        s.thump_y1 = thump;
        const float thump_out = thump * (kThumpGain * (1.0f - 0.5f * open));

        // --- radio from the dash speakers --------------------------------
        const float radio_gain = c[kRadio];
        const size_t at = static_cast<size_t>(i);
        float rl = in_l.empty() ? 0.0f : in_l[at];
        float rr = in_r.empty() ? 0.0f : in_r[at];
        if (!(rl >= -kInputLimit && rl <= kInputLimit)) rl = 0.0f;
        if (!(rr >= -kInputLimit && rr <= kInputLimit)) rr = 0.0f;
        rl *= radio_gain;
        rr *= radio_gain;

        // --- place, occlude, mix ----------------------------------------
        float wind_l = 0.0f;
        float wind_r = 0.0f;
        hrtf_voice_step(s.wind_voice, wind_src, wind_l, wind_r);
        const float occ_a = s.occ_a_closed + (s.occ_a_open - s.occ_a_closed) * open;
        s.occ_l += occ_a * (((eng + road_l) + wind_l) - s.occ_l);
        s.occ_r += occ_a * (((eng + road_r) + wind_r) - s.occ_r);

        float radio_l = 0.0f;
        float radio_r = 0.0f;
        hrtf_voice_step(s.radio_l_voice, rl, radio_l, radio_r);
        hrtf_voice_step(s.radio_r_voice, rr, radio_l, radio_r);

        s.hist_l[kHistoryOffset + i] = ((s.occ_l + rain_l) + thump_out) + radio_l;
        s.hist_r[kHistoryOffset + i] = ((s.occ_r + rain_r) + thump_out) + radio_r;
        ++s.sample;
    }

    // --- cabin FIR, crossfading from the previous IR after a swap -------
    const int len = s.ir_len;
    fir_block(s.ir[s.ir_cur], s.hist_l + (kHistoryOffset - (len - 1)), len, frames, s.wet_l);
    fir_block(s.ir[s.ir_cur], s.hist_r + (kHistoryOffset - (len - 1)), len, frames, s.wet_r);
    if (s.xfade_pos < kXfadeFrames) {
        const int plen = s.prev_ir_len;
        fir_block(s.ir[1 - s.ir_cur], s.hist_l + (kHistoryOffset - (plen - 1)), plen, frames, s.old_l);
        fir_block(s.ir[1 - s.ir_cur], s.hist_r + (kHistoryOffset - (plen - 1)), plen, frames, s.old_r);
    }
    for (int n = 0; n < frames; ++n) {
        float yl = s.wet_l[n];
        float yr = s.wet_r[n];
        if (s.xfade_pos < kXfadeFrames) {
            const float ol = s.old_l[n];
            const float orr = s.old_r[n];
            const float g = static_cast<float>(s.xfade_pos + 1) * kInvXfadeFrames;
            yl = ol + (yl - ol) * g;
            yr = orr + (yr - orr) * g;
            ++s.xfade_pos;
        }
        const float dl = (yl - s.dc_x_l) + (s.dc_r * s.dc_y_l);
        const float dr = (yr - s.dc_x_r) + (s.dc_r * s.dc_y_r);
        s.dc_x_l = yl;
        s.dc_y_l = dl;
        s.dc_x_r = yr;
        s.dc_y_r = dr;
        if (!out_l.empty()) out_l[static_cast<size_t>(n)] = clampf(dl, -1.0f, 1.0f);
        if (!out_r.empty()) out_r[static_cast<size_t>(n)] = clampf(dr, -1.0f, 1.0f);
    }

    std::memmove(s.hist_l, s.hist_l + frames, sizeof(float) * static_cast<size_t>(kHistoryOffset));
    std::memmove(s.hist_r, s.hist_r + frames, sizeof(float) * static_cast<size_t>(kHistoryOffset));
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

sw_dsp* sw_dsp_create(float sample_rate) {
    if (!(sample_rate > 1.0f)) sample_rate = 44100.0f;
    if (sample_rate > 192000.0f) sample_rate = 192000.0f;
    void* mem = std::malloc(sizeof(DspState));
    if (mem == nullptr) return nullptr;
    std::memset(mem, 0, sizeof(DspState));
    DspState& s = *static_cast<DspState*>(mem);

    const float sr = sample_rate;
    s.sample_rate = sr;
    s.inv_sample_rate = 1.0 / static_cast<double>(sr);
    s.smooth_k = 1.0f / (kSmoothSeconds * sr);

    s.rumble_a = pole_coeff(kRumbleHz, sr);
    s.hiss_a = pole_coeff(kHissSplitHz, sr);
    s.wind_a_lo = pole_coeff(kWindLoHz, sr);
    s.wind_a_hi = pole_coeff(kWindHiHz, sr);
    s.wind_base_a = pole_coeff(kWindBaseHz, sr);
    s.gust_a = pole_coeff(kGustHz, sr);
    s.drop_decay = 1.0f - 1.0f / (kDropDecaySeconds * sr);
    s.drop_p_scale = kDropRatePerSec / sr;
    s.drum_a = pole_coeff(kDrumHz, sr);
    s.rain_hiss_a = pole_coeff(kRainHissHz, sr);
    s.occ_a_closed = pole_coeff(kOccClosedHz, sr);
    s.occ_a_open = pole_coeff(kOccOpenHz, sr);
    s.dc_r = 1.0f - pole_coeff(kDcHz, sr);

    // Two-pole resonator y = 2 r cos(w) y1 - r^2 y2 + x, with a Taylor
    // cosine (w <= 2*pi*55/8000 here, where the 4th-order term is exact to
    // f32) and the impulse scaled by ~sin(w) so its peak is ~1.
    const float w = pole_coeff(kThumpHz, sr);
    const float r = 1.0f - 1.0f / (kThumpDecaySeconds * sr);
    const float w2 = w * w;
    const float cosw = (1.0f - w2 * 0.5f) + (w2 * w2) * kInv24;
    s.thump_c1 = (2.0f * r) * cosw;
    s.thump_c2 = r * r;
    s.thump_kick = w;

    hrtf_voice_init(s.wind_voice, kWindAzimuth, sr);
    hrtf_voice_init(s.radio_l_voice, -kSpeakerAzimuth, sr);
    hrtf_voice_init(s.radio_r_voice, kSpeakerAzimuth, sr);

    // Start on an identity IR (one partition, unit tap at lag 0), already
    // settled: the first dsp_set_ir crossfades from it into the cabin.
    s.ir_cur = 0;
    s.ir_len = kQuantum;
    s.prev_ir_len = kQuantum;
    s.ir[0][kQuantum - 1] = 1.0f;
    s.ir[1][kQuantum - 1] = 1.0f;
    s.xfade_pos = kXfadeFrames;
    return static_cast<sw_dsp*>(mem);
}

void sw_dsp_destroy(sw_dsp* state) {
    std::free(state);
}

void sw_dsp_set_params(sw_dsp* state, float rpm, float load, float speed_mps,
                       float openness, int vehicle, float wet_road, float rain,
                       float wind_mps, float radio_gain, int wipers) {
    if (state == nullptr) return;
    DspState& s = *reinterpret_cast<DspState*>(state);
    s.target[kRpm] = clampf(rpm, 0.0f, 12000.0f);
    s.target[kLoad] = clampf(load, 0.0f, 1.0f);
    s.target[kSpeed] = clampf(speed_mps, 0.0f, 120.0f);
    s.target[kOpen] = clampf(openness, 0.0f, 1.0f);
    s.target[kWet] = clampf(wet_road, 0.0f, 1.0f);
    s.target[kRain] = clampf(rain, 0.0f, 1.0f);
    s.target[kWind] = clampf(wind_mps, 0.0f, 60.0f);
    s.target[kRadio] = clampf(radio_gain, 0.0f, 2.0f);
    if (vehicle < 0) vehicle = 0;
    if (vehicle >= kVehicleCount) vehicle = kVehicleCount - 1;
    const VehicleVoice& v = kVehicleVoices[vehicle];
    s.target[kVehEngine] = v.engine;
    s.target[kVehRoad] = v.road;
    s.target[kVehWind] = v.wind;
    s.wipers = wipers != 0 ? 1 : 0;
}

void sw_dsp_set_ir(sw_dsp* state, const float* taps, int count) {
    if (state == nullptr) return;
    DspState& s = *reinterpret_cast<DspState*>(state);
    // A missing IR is the identity: the bed passes through dry.
    const bool identity = taps == nullptr || count <= 0;
    int n = identity ? 1 : count;
    if (n > kMaxIrTaps) n = kMaxIrTaps;
    const int len = ((n + kQuantum - 1) / kQuantum) * kQuantum;

    // Write into the idle buffer, then fade from the current one. A swap
    // that lands mid-fade restarts the fade from the IR that was fading in.
    const int next = 1 - s.ir_cur;
    const std::span<float> hr(s.ir[next], static_cast<size_t>(len));
    const std::span<const float> in = identity
        ? std::span<const float>{}
        : std::span<const float>(taps, static_cast<size_t>(n));
    for (float& tap : hr) tap = 0.0f;
    for (int t = 0; t < n; ++t) {
        float v = identity ? 1.0f : in[static_cast<size_t>(t)];
        if (!(v >= -16.0f && v <= 16.0f)) v = 0.0f;
        hr[static_cast<size_t>(len - 1 - t)] = v;
    }
    s.prev_ir_len = s.ir_len;
    s.ir_cur = next;
    s.ir_len = len;
    s.xfade_pos = 0;
}

void sw_dsp_render(sw_dsp* state, const float* radio_in_l, const float* radio_in_r,
                   float* out_l, float* out_r, int frames) {
    if (state == nullptr || frames <= 0) return;
    DspState& s = *reinterpret_cast<DspState*>(state);
    const size_t total = static_cast<size_t>(frames);
    const auto in_span = [total](const float* p) {
        return p != nullptr ? std::span<const float>(p, total) : std::span<const float>{};
    };
    const auto out_span = [total](float* p) {
        return p != nullptr ? std::span<float>(p, total) : std::span<float>{};
    };
    const std::span<const float> in_l = in_span(radio_in_l);
    const std::span<const float> in_r = in_span(radio_in_r);
    const std::span<float> o_l = out_span(out_l);
    const std::span<float> o_r = out_span(out_r);
    const auto chunk_of = [](auto whole, size_t at, size_t count) {
        return whole.empty() ? decltype(whole){} : whole.subspan(at, count);
    };
    int done = 0;
    while (done < frames) {
        const int chunk = frames - done < kQuantum ? frames - done : kQuantum;
        const size_t at = static_cast<size_t>(done);
        const size_t count = static_cast<size_t>(chunk);
        render_block(s, chunk_of(in_l, at, count), chunk_of(in_r, at, count),
                     chunk_of(o_l, at, count), chunk_of(o_r, at, count), chunk);
        done += chunk;
    }
}

int sw_dsp_max_ir_taps(void) {
    return kMaxIrTaps;
}

} // extern "C"
