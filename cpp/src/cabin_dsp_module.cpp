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
 *       cabin convolver (≤ 16384 taps, zero added latency, see below)
 *                                  ─► DC blocker ─► clamp ─► out L/R
 *
 * The convolution and the head shadow are both linear and time-invariant, so
 * placing each source first and then running one stereo cabin FIR is the
 * same room as convolving every source, at a fraction of the cost.
 *
 * The cabin convolver is uniformly partitioned overlap-save (UPOLS):
 *   - partition = the 128-frame render quantum; the IR splits into K of them;
 *   - partition 0 (lags 0..127) runs direct-form, per sample, so the output
 *     has no latency beyond the room itself;
 *   - partitions 1..K-1 run in the frequency domain: at every partition
 *     boundary one 256-point FFT of the last two input blocks — L and R packed
 *     as one complex signal, xL + i xR, which a real IR convolves channel by
 *     channel — goes into a frequency-domain delay line (FDL) of K-1 spectra;
 *     the next block's tail is IFFT(sum_k H_k * FDL[k-1]), last 128 samples:
 *     real part L, imaginary part R.
 *   At 2048 taps that is 128 direct MACs plus ~1 FFT-bin MAC per partition
 *   per sample, instead of 2048 MACs (scripts/bench-cabin-dsp.mjs; WASM.md).
 *
 * IR swaps cost no more than steady state. Each FDL slot remembers the IR
 * that was current when its input arrived, so input before a swap keeps
 * ringing through the old room's tail and input after it goes through the new
 * one — one convolution, never two. The direct partition (the loud, early
 * part) glides from the old taps to the new over kGlideFrames. A
 * swap that lands while slots still reference the IR before the previous one
 * hands their remaining tail to the previous IR (both buffers are needed).
 *
 * Determinism contract (what the goldens pin):
 *   - Only add/sub/mul/div, comparisons, and floor on the f64 phases. No
 *     transcendentals: filter coefficients use 2*pi*f/fs (clamped to 1) and
 *     the thump resonator a Taylor cosine.
 *   - Noise is a hash of a 32-bit sample counter (sv_audio::hash_u32), so the
 *     output does not depend on how the caller splits blocks.
 *   - The direct partition's dot product has one canonical summation order:
 *     four lane accumulators over j mod 4 in increasing j, then
 *     (a0 + a1) + (a2 + a3). The FFT (streetview/fft256.h), the spectral MAC
 *     (partitions in increasing k, per bin) and the tail add are written once
 *     over sv_simd::f4 (streetview/simd.h): f32x4 lanes on the SIMD builds, a
 *     struct of four floats on the scalar reference — the same IEEE ops in the
 *     same order. WASM SIMD has no FMA and we never pass -ffast-math, so every
 *     binary and host build agrees to the last bit.
 *
 * Memory: dsp_create mallocs the state (~800 KiB: two IRs' spectra and the
 * FDL at the 16384-tap ceiling) from the module's own heap. In the worklet
 * binary that heap is fixed (1 MiB, no memory.grow). There are no mutable
 * globals; every instance is independent. dsp_render and dsp_set_ir never
 * allocate.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview/abi.h"
#include "streetview/audio_kernels.h"
#include "streetview/fft256.h"
#include "streetview/simd.h"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <span>

namespace {

using sv_audio::hash_u32;
using sv_audio::hash_unit;

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------
/** Partition == the Web Audio render quantum. */
constexpr int kQuantum = 128;
/** Longest IR dsp_set_ir accepts (341 ms at 48 kHz). */
constexpr int kMaxIrTaps = 16384;
constexpr int kMaxParts = kMaxIrTaps / kQuantum;
/** FFT size of one overlap-save step: two blocks. */
constexpr int kFft = sv_fft::kN;
/** FDL ring (power of two >= the kMaxParts - 1 tail partitions). */
constexpr int kFdlSlots = kMaxParts;
constexpr int kFdlMask = kFdlSlots - 1;
/**
 * The direct partition glides to a new IR over kGlideFrames (~21 ms at
 * 48 kHz), re-interpolating its 128 taps every kGlideStep frames: 64 steps of
 * 1/64th, which a stepped-per-quantum glide (1/8th) made audible as a click.
 * That is 128 lerps per 16 frames (~6 % of the direct partition), only while
 * gliding. Steps are keyed to the absolute glide position, so how the caller
 * splits blocks still never changes a bit.
 */
constexpr int kGlideFrames = 1024;
constexpr int kGlideStep = 16;
constexpr float kInvGlideSteps = static_cast<float>(kGlideStep) / static_cast<float>(kGlideFrames);
static_assert(kGlideFrames % kGlideStep == 0 && kGlideStep % 4 == 0,
              "whole fir_dot4 groups per step");
/** H_k spectra are pre-scaled by 1/kFft (exact) so the inverse FFT needs no scale. */
constexpr float kInvFft = 1.0f / static_cast<float>(kFft);
// The worklet (CABIN_QUANTUM in src/car/audio/cabinWorkletSource.ts) and the
// loader's createCabinDsp pack their I/O block as 4 x 128 floats + the IR.
static_assert(kQuantum == 128, "the Web Audio render quantum; the TS I/O blocks are sized from it");
static_assert(kFft == 2 * kQuantum, "overlap-save: FFT of the previous and the current block");
static_assert(kMaxIrTaps % kQuantum == 0, "IRs pad to whole partitions");
static_assert((kFdlSlots & kFdlMask) == 0 && kFdlSlots >= kMaxParts - 1, "FDL ring");
/** Power of two above the longest ITD (127 taps at 192 kHz). */
constexpr int kItdRing = 256;
constexpr int kItdMask = kItdRing - 1;

// ---------------------------------------------------------------------------
// Voice constants (levels are linear, times seconds, frequencies Hz)
// ---------------------------------------------------------------------------
constexpr float kTwoPi = 6.2831855f;
constexpr float kSmoothSeconds = 0.04f;
constexpr float kInvSpeedFullMps = 0.025f; // 40 m/s = full road / wind noise
constexpr float kEngineGain = 0.42f;
constexpr float kRumbleHz = 110.0f;
constexpr float kRumbleGain = 2.6f;
constexpr float kHissSplitHz = 2200.0f; // wet hiss = white minus this low-pass
constexpr float kDryHissGain = 0.02f;
constexpr float kWetHissGain = 0.12f;
constexpr float kSprayGain = 1.4f;   // wet-arch spray: the rumble..hiss band
constexpr float kWindLoHz = 250.0f;  // band top at no wind ...
constexpr float kWindHiHz = 1600.0f; // ... and at full wind
constexpr float kWindBaseHz = 90.0f; // band bottom
constexpr float kWindGain = 0.9f;
constexpr float kGustHz = 0.6f;
constexpr float kGustScale = 18.0f;
constexpr float kDropRatePerSec = 1400.0f; // at rain = 1
constexpr float kDropDecaySeconds = 0.0025f;
constexpr float kDrumHz = 400.0f;
constexpr float kDrumGain = 0.55f;
constexpr float kTickGain = 0.10f;
constexpr float kRainHissHz = 5000.0f;
constexpr float kRainHissGain = 0.05f;
constexpr float kWiperRainMin = 0.02f;
constexpr float kWiperBaseHz = 0.6f; // sweeps per second, light rain ...
constexpr float kWiperRainHz = 0.6f; // ... plus this much at rain = 1
constexpr float kThumpHz = 55.0f;
constexpr float kThumpDecaySeconds = 0.06f;
constexpr float kThumpGain = 0.25f;
constexpr float kOccClosedHz = 700.0f; // body occlusion, roof sealed ...
constexpr float kOccOpenHz = 6000.0f;  // ... and fully open
constexpr float kDcHz = 20.0f;
constexpr float kInv255 = 1.0f / 255.0f;
constexpr float kInv24 = 1.0f / 24.0f;
constexpr float kInputLimit = 8.0f;      // radio samples outside +-8 (or NaN) are dropped
constexpr float kWindAzimuth = -55.0f;   // the driver's window
constexpr float kSpeakerAzimuth = 30.0f; // dash speakers at +-30 degrees

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

enum Param : uint8_t {
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
    {1.00f, 1.00f, 1.00f}, // sedan
    {1.05f, 1.10f, 1.30f}, // convertible — thin soft top
    {0.90f, 1.20f, 0.90f}, // science-lab — boxy, loud tyres
    {0.60f, 0.60f, 0.65f}, // limousine — heavy insulation
    {1.35f, 1.05f, 1.10f}, // cortianics — sport exhaust
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

    // --- cabin convolver (see the file header) --------------------------
    // Input: [previous block | current block] per channel; `fill` samples of
    // the current block are written. The direct partition reads 128 back.
    float xin_l[kFft];
    float xin_r[kFft];
    int fill;
    // Tail (partitions 1..K-1) of the current block, from the last boundary.
    float tail_l[kQuantum];
    float tail_r[kQuantum];
    // Two IR buffers: `ir_cur` is current, the other is the previous one (or
    // idle). Direct taps time-reversed; tail spectra H_1..H_{K-1}, 1/256-scaled.
    int ir_cur;
    int ir_parts[2];
    float ir_direct[2][kQuantum];
    float h_re[2][kMaxParts - 1][kFft];
    float h_im[2][kMaxParts - 1][kFft];
    // Direct partition actually in use, gliding from `direct_from` to the
    // current IR's taps; `glide_pos` frames into the glide (kGlideFrames = done).
    float direct[kQuantum];
    float direct_from[kQuantum];
    int glide_pos;
    // FDL: the spectrum of each past block pair, newest at `fdl_head`, and
    // which IR buffer (0/1) convolves it; -1 = no tail (identity-length IR).
    float fdl_re[kFdlSlots][kFft];
    float fdl_im[kFdlSlots][kFft];
    int fdl_ir[kFdlSlots];
    int fdl_head;
    // FFT work.
    float acc_re[kFft], acc_im[kFft], tmp_re[kFft], tmp_im[kFft];
    float y_l[kQuantum], y_r[kQuantum];
};

inline float clampf(float v, float lo, float hi) {
    if (!(v >= lo)) return lo; // also catches NaN
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
    const float delayed =
        v.ring[(static_cast<unsigned>(v.pos) - static_cast<unsigned>(v.delay)) & mask];
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

/**
 * The canonical direct-partition dot product (see the file header): four lane
 * accumulators over j mod 4, then (a0 + a1) + (a2 + a3). `n` is a multiple of 4.
 */
inline float fir_dot(const float* hr, const float* x, int n) {
    using namespace sv_simd;
    f4 acc = splat(0.0f);
    for (int j = 0; j < n; j += 4) acc = add(acc, mul(load(hr + j), load(x + j)));
    return hsum(acc);
}

/**
 * fir_dot for four consecutive outputs (x, x + 1, x + 2, x + 3). Each output
 * keeps its own four-lane accumulator, so the sums are bit-identical to four
 * fir_dot calls; each tap vector is just loaded once instead of four times.
 */
inline void fir_dot4(const float* hr, const float* x, int n, float out[4]) {
    using namespace sv_simd;
    f4 a0 = splat(0.0f);
    f4 a1 = a0;
    f4 a2 = a0;
    f4 a3 = a0;
    for (int j = 0; j < n; j += 4) {
        const f4 h = load(hr + j);
        a0 = add(a0, mul(h, load(x + j)));
        a1 = add(a1, mul(h, load(x + j + 1)));
        a2 = add(a2, mul(h, load(x + j + 2)));
        a3 = add(a3, mul(h, load(x + j + 3)));
    }
    out[0] = hsum(a0);
    out[1] = hsum(a1);
    out[2] = hsum(a2);
    out[3] = hsum(a3);
}

/** The direct partition over `frames` outputs into y. */
inline void fir_block(const float* hr, const float* x, int len, int frames, float* y) {
    int n = 0;
    for (; n + 4 <= frames; n += 4) fir_dot4(hr, x + n, len, y + n);
    for (; n < frames; ++n) y[n] = fir_dot(hr, x + n, len);
}

/**
 * direct = from + (to - from) * g for the glide step containing `glide_pos`
 * (g = (step + 1) / 64), or exactly the current IR's taps once it is over.
 */
void update_direct(DspState& s) {
    using namespace sv_simd;
    const float* to = s.ir_direct[s.ir_cur];
    if (s.glide_pos >= kGlideFrames) {
        for (int j = 0; j < kQuantum; ++j) s.direct[j] = to[j];
        return;
    }
    const int step = s.glide_pos / kGlideStep; // whole 16-frame steps: an integer on purpose
    const f4 g = splat(static_cast<float>(step + 1) * kInvGlideSteps);
    for (int j = 0; j < kQuantum; j += 4) {
        const f4 from = load(s.direct_from + j);
        store(s.direct + j, add(from, mul(sub(load(to + j), from), g)));
    }
}

/** Is FDL slot `age` (0 = newest) still inside the tail of the IR it is tagged with? */
inline bool slot_live(const DspState& s, int age) {
    const int tag = s.fdl_ir[(s.fdl_head - age) & kFdlMask];
    return tag >= 0 && age + 1 < s.ir_parts[tag];
}

/**
 * A partition boundary: the current block is complete. Push its block pair
 * into the FDL, compute the next block's tail, and start the next block.
 */
void partition_boundary(DspState& s) {
    using namespace sv_simd;
    s.fdl_head = (s.fdl_head + 1) & kFdlMask;
    const int head = s.fdl_head;
    const int tag = s.ir_parts[s.ir_cur] > 1 ? s.ir_cur : -1;
    s.fdl_ir[head] = tag;
    if (tag >= 0) {
        float* re = s.fdl_re[head];
        float* im = s.fdl_im[head];
        for (int n = 0; n < kFft; n += 4) {
            store(re + n, load(s.xin_l + n));
            store(im + n, load(s.xin_r + n));
        }
        sv_fft::fft256(re, im, s.tmp_re, s.tmp_im);
    }

    // Tail of the next block: partition k = age + 1 of each live slot's IR,
    // accumulated in increasing k per bin.
    const int ages = (s.ir_parts[0] > s.ir_parts[1] ? s.ir_parts[0] : s.ir_parts[1]) - 1;
    bool any = false;
    for (int age = 0; age < ages; ++age) {
        if (!slot_live(s, age)) continue;
        const int slot = (head - age) & kFdlMask;
        const int t = s.fdl_ir[slot];
        const float* hr = s.h_re[t][age];
        const float* hi = s.h_im[t][age];
        const float* xr = s.fdl_re[slot];
        const float* xi = s.fdl_im[slot];
        if (!any) {
            for (int n = 0; n < kFft; n += 4) {
                const f4 a = load(hr + n), b = load(hi + n), c = load(xr + n), d = load(xi + n);
                store(s.acc_re + n, sub(mul(a, c), mul(b, d)));
                store(s.acc_im + n, add(mul(a, d), mul(b, c)));
            }
            any = true;
        } else {
            for (int n = 0; n < kFft; n += 4) {
                const f4 a = load(hr + n), b = load(hi + n), c = load(xr + n), d = load(xi + n);
                store(s.acc_re + n, add(load(s.acc_re + n), sub(mul(a, c), mul(b, d))));
                store(s.acc_im + n, add(load(s.acc_im + n), add(mul(a, d), mul(b, c))));
            }
        }
    }
    if (any) {
        // Inverse via swapped re/im: the transform's re output is the
        // inverse's imaginary part (R), its im output the real part (L).
        sv_fft::fft256(s.acc_im, s.acc_re, s.tmp_re, s.tmp_im);
        for (int n = 0; n < kQuantum; n += 4) {
            store(s.tail_l + n, load(s.acc_re + kQuantum + n));
            store(s.tail_r + n, load(s.acc_im + kQuantum + n));
        }
    } else {
        for (int n = 0; n < kQuantum; ++n) {
            s.tail_l[n] = 0.0f;
            s.tail_r[n] = 0.0f;
        }
    }

    // The current block becomes the previous one.
    for (int n = 0; n < kQuantum; n += 4) {
        store(s.xin_l + n, load(s.xin_l + kQuantum + n));
        store(s.xin_r + n, load(s.xin_r + kQuantum + n));
    }
    s.fill = 0;
}

/**
 * Render one chunk that ends at or before the next partition boundary
 * (`frames` <= kQuantum - fill). An empty input span is silence and an empty
 * output span is discarded — the extern "C" nullptrs.
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
        const float eng = sv_audio::engine_tone(s.engine_phase, 0.22f + 0.78f * c[kLoad]) *
                          (kEngineGain * c[kVehEngine]);
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
        const float road_l =
            (((s.rumble_l * kRumbleGain) + ((w_road_l - s.hiss_lp_l) * hiss_gain)) +
             ((s.hiss_lp_l - s.rumble_l) * spray_gain)) *
            road_gain;
        const float road_r =
            (((s.rumble_r * kRumbleGain) + ((w_road_r - s.hiss_lp_r) * hiss_gain)) +
             ((s.hiss_lp_r - s.rumble_r) * spray_gain)) *
            road_gain;

        // --- wind: a band of noise that widens and rises with airspeed ----
        float w = (c[kSpeed] + 0.5f * c[kWind]) * kInvSpeedFullMps;
        if (w > 1.0f) w = 1.0f;
        const float wind_a = s.wind_a_lo + (s.wind_a_hi - s.wind_a_lo) * w;
        s.wind_lp1 += wind_a * (w_wind - s.wind_lp1);
        s.wind_lp2 += s.wind_base_a * (s.wind_lp1 - s.wind_lp2);
        s.gust += s.gust_a * (w_gust - s.gust);
        const float gust_amp = clampf(0.75f + s.gust * kGustScale, 0.25f, 1.25f);
        const float wind_src = (((s.wind_lp1 - s.wind_lp2) * ((w * w) * (0.2f + 0.8f * open))) *
                                (kWindGain * c[kVehWind])) *
                               gust_amp;

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
        const float drop =
            (s.drum_lp * (kDrumGain * (1.0f - open))) + (tick * (kTickGain * (0.3f + 0.7f * open)));
        const float hiss_amp = rain * (kRainHissGain * (0.4f + 0.6f * open));
        const float rain_l = (drop * (1.0f - s.drop_pan)) + (s.rain_lp_l * hiss_amp);
        const float rain_r = (drop * s.drop_pan) + (s.rain_lp_r * hiss_amp);

        // --- wiper thump at each end of the sweep ------------------------
        float thump_in = 0.0f;
        if (s.wipers != 0 && rain > kWiperRainMin) {
            const double before = s.wiper_phase;
            s.wiper_phase +=
                static_cast<double>(kWiperBaseHz + kWiperRainHz * rain) * s.inv_sample_rate;
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

        s.xin_l[kQuantum + s.fill + i] = ((s.occ_l + rain_l) + thump_out) + radio_l;
        s.xin_r[kQuantum + s.fill + i] = ((s.occ_r + rain_r) + thump_out) + radio_r;
        ++s.sample;
    }

    // --- cabin convolver: direct partition + the tail from the last boundary
    const int at = s.fill;
    for (int done = 0; done < frames;) {
        // While gliding, one run per glide step (the taps change between runs).
        int run = frames - done;
        if (s.glide_pos < kGlideFrames) {
            const int left_in_step = kGlideStep - s.glide_pos % kGlideStep;
            if (run > left_in_step) run = left_in_step;
        }
        fir_block(s.direct, s.xin_l + at + done + 1, kQuantum, run, s.y_l + done);
        fir_block(s.direct, s.xin_r + at + done + 1, kQuantum, run, s.y_r + done);
        done += run;
        if (s.glide_pos < kGlideFrames) {
            s.glide_pos += run;
            if (s.glide_pos % kGlideStep == 0) update_direct(s);
        }
    }
    for (int n = 0; n < frames; ++n) {
        const float yl = s.y_l[n] + s.tail_l[at + n];
        const float yr = s.y_r[n] + s.tail_r[at + n];
        const float dl = (yl - s.dc_x_l) + (s.dc_r * s.dc_y_l);
        const float dr = (yr - s.dc_x_r) + (s.dc_r * s.dc_y_r);
        s.dc_x_l = yl;
        s.dc_y_l = dl;
        s.dc_x_r = yr;
        s.dc_y_r = dr;
        if (!out_l.empty()) out_l[static_cast<size_t>(n)] = clampf(dl, -1.0f, 1.0f);
        if (!out_r.empty()) out_r[static_cast<size_t>(n)] = clampf(dr, -1.0f, 1.0f);
    }

    s.fill += frames;
    if (s.fill == kQuantum) partition_boundary(s);
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
    // settled: the first dsp_set_ir glides from it into the cabin. Nothing in
    // the FDL yet (-1: no tail).
    s.ir_cur = 0;
    for (int b = 0; b < 2; ++b) {
        s.ir_parts[b] = 1;
        s.ir_direct[b][kQuantum - 1] = 1.0f;
    }
    for (int slot = 0; slot < kFdlSlots; ++slot) s.fdl_ir[slot] = -1;
    s.glide_pos = kGlideFrames;
    update_direct(s);
    return static_cast<sw_dsp*>(mem);
}

void sw_dsp_destroy(sw_dsp* state) {
    std::free(state);
}

void sw_dsp_set_params(sw_dsp* state, float rpm, float load, float speed_mps, float openness,
                       int vehicle, float wet_road, float rain, float wind_mps, float radio_gain,
                       int wipers) {
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
    const int parts = (n + kQuantum - 1) / kQuantum;
    const std::span<const float> in =
        identity ? std::span<const float>{} : std::span<const float>(taps, static_cast<size_t>(n));
    const auto tap = [&](int t) {
        if (t >= n) return 0.0f;
        const float v = identity ? 1.0f : in[static_cast<size_t>(t)];
        return v >= -16.0f && v <= 16.0f ? v : 0.0f;
    };

    // Write into the idle buffer. Slots that still convolve with it (input
    // from before the previous swap) hand their remaining tail to the
    // current IR; everything else keeps its room.
    const int next = 1 - s.ir_cur;
    for (int slot = 0; slot < kFdlSlots; ++slot) {
        if (s.fdl_ir[slot] == next) s.fdl_ir[slot] = s.ir_cur;
    }
    for (int j = 0; j < kQuantum; ++j) s.ir_direct[next][kQuantum - 1 - j] = tap(j);
    for (int k = 1; k < parts; ++k) {
        float* re = s.h_re[next][k - 1];
        float* im = s.h_im[next][k - 1];
        for (int j = 0; j < kQuantum; ++j) {
            re[j] = tap(k * kQuantum + j) * kInvFft;
            re[kQuantum + j] = 0.0f;
        }
        for (int j = 0; j < kFft; ++j) im[j] = 0.0f;
        sv_fft::fft256(re, im, s.tmp_re, s.tmp_im);
    }
    s.ir_parts[next] = parts;

    // The direct partition glides from whatever it is now (mid-glide too)
    // to the new taps; its first step lands immediately.
    for (int j = 0; j < kQuantum; ++j) s.direct_from[j] = s.direct[j];
    s.ir_cur = next;
    s.glide_pos = 0;
    update_direct(s);
}

void sw_dsp_render(sw_dsp* state, const float* radio_in_l, const float* radio_in_r, float* out_l,
                   float* out_r, int frames) {
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
        // Chunks end at partition boundaries (absolute, every 128 samples of
        // the stream), so how the caller splits blocks never changes a bit.
        const int room = kQuantum - s.fill;
        const int chunk = frames - done < room ? frames - done : room;
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
