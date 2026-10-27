/**
 * cpp/tests/cabin_dsp_test.cpp
 *
 * Host tests for the cabin engine (cpp/src/cabin_dsp_module.cpp, the dsp_*
 * exports the AudioWorklet runs) and the fused luma chore (sw_luma_analyze).
 *
 * The dsp_render goldens are parameter scripts captured from the shipping
 * scalar binary by scripts/gen-wasm-goldens.mjs (the SIMD binary is checked
 * against the same vectors with `--compare`, and both binaries through the TS
 * loader by src/wasm/__tests__/wasmGoldenParity.test.ts). The harness below is the one
 * that script documents: keyframes at block boundaries, 128-frame renders,
 * the radioSample() input, FNV-1a over the f32 bits, L then R.
 */

#include "doctest.h"

#include "streetview_wasm.h"
#include "goldens_generated.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace {

bool bits_equal(float a, float b) {
    // NOLINTNEXTLINE(bugprone-suspicious-memory-comparison) — bit-exact on purpose.
    return std::memcmp(&a, &b, sizeof(float)) == 0;
}

uint32_t bits_of(float v) {
    uint32_t u = 0;
    std::memcpy(&u, &v, sizeof(u));
    return u;
}

uint32_t fnv1a(uint32_t h, const std::vector<float>& words, int count) {
    for (int i = 0; i < count; ++i) {
        h ^= bits_of(words[static_cast<size_t>(i)]);
        h *= 16777619u;
    }
    return h;
}

/** The golden harness's radio input (see scripts/gen-wasm-goldens.mjs). */
float radio_sample(int64_t k, int ch) {
    const int64_t v = ((k % 2001) * 7919 + ch * 104729) % 2001;
    return static_cast<float>(v - 1000) / 2000.0f;
}

struct Rendered {
    uint32_t checksum = 2166136261u;
    std::vector<std::vector<float>> excerpt_l;
    std::vector<std::vector<float>> excerpt_r;
};

/**
 * Run a golden script. `chunks` splits every 128-frame block into renders of
 * those sizes (cycled) — the output must not depend on it.
 */
Rendered run_script(const goldens::DspScript& script, const std::vector<int>& chunks = {128}) {
    const int block = goldens::kDspBlock;
    sw_dsp* dsp = sw_dsp_create(script.sample_rate);
    REQUIRE(dsp != nullptr);
    std::vector<float> ir(static_cast<size_t>(script.ir_taps));
    std::vector<float> in_l(static_cast<size_t>(block)), in_r(static_cast<size_t>(block));
    std::vector<float> out_l(static_cast<size_t>(block)), out_r(static_cast<size_t>(block));
    Rendered r;
    int k = 0;
    size_t chunk_index = 0;
    for (int b = 0; b < script.blocks; ++b) {
        if (k < script.keyframe_count && script.keyframes[k].block == b) {
            const goldens::DspKeyframe& f = script.keyframes[k];
            sw_dsp_set_params(dsp, f.rpm, f.load, f.speed_mps, f.openness, f.vehicle,
                              f.wet_road, f.rain, f.wind_mps, f.radio_gain, f.wipers);
            if (f.ir == 1) {
                sw_fill_cabin_ir(ir.data(), script.ir_taps, f.ir_vehicle, f.ir_openness,
                                 script.sample_rate);
                sw_dsp_set_ir(dsp, ir.data(), script.ir_taps);
            } else if (f.ir == 2) {
                sw_dsp_set_ir(dsp, nullptr, 0);
            }
            ++k;
        }
        for (int i = 0; i < block; ++i) {
            in_l[static_cast<size_t>(i)] = radio_sample(static_cast<int64_t>(b) * block + i, 0);
            in_r[static_cast<size_t>(i)] = radio_sample(static_cast<int64_t>(b) * block + i, 1);
        }
        int done = 0;
        while (done < block) {
            int n = chunks[chunk_index % chunks.size()];
            ++chunk_index;
            if (n > block - done) n = block - done;
            sw_dsp_render(dsp, in_l.data() + done, in_r.data() + done,
                          out_l.data() + done, out_r.data() + done, n);
            done += n;
        }
        r.checksum = fnv1a(r.checksum, out_l, block);
        r.checksum = fnv1a(r.checksum, out_r, block);
        for (int e = 0; e < script.excerpt_count; ++e) {
            if (script.excerpts[e].block == b) {
                r.excerpt_l.push_back(out_l);
                r.excerpt_r.push_back(out_r);
            }
        }
    }
    sw_dsp_destroy(dsp);
    return r;
}

/** A steady scene: params + the cabin IR for (vehicle, openness). */
struct Scene {
    float rpm = 850.0f, load = 0.12f, speed = 0.0f, open = 0.0f;
    int vehicle = 0;
    float wet = 0.0f, rain = 0.0f, wind = 0.0f, radio = 0.0f;
    int wipers = 0;
    int ir_taps = 1024;
};

struct Levels {
    double rms;   // broadband
    double hf;    // RMS of the first difference — a crude high-frequency meter
};

/**
 * Render a scene for `seconds` after a one-second settle; `radio` feeds the
 * radio input with the golden pseudo-random signal.
 */
Levels measure(const Scene& s, float seconds = 1.0f, float sample_rate = 48000.0f) {
    sw_dsp* dsp = sw_dsp_create(sample_rate);
    std::vector<float> ir(static_cast<size_t>(s.ir_taps));
    sw_fill_cabin_ir(ir.data(), s.ir_taps, s.vehicle, s.open, sample_rate);
    sw_dsp_set_ir(dsp, ir.data(), s.ir_taps);
    sw_dsp_set_params(dsp, s.rpm, s.load, s.speed, s.open, s.vehicle, s.wet, s.rain,
                      s.wind, s.radio, s.wipers);
    std::vector<float> in_l(128), in_r(128), l(128), r(128);
    const int settle = static_cast<int>(sample_rate / 128.0f);
    const int blocks = static_cast<int>(seconds * sample_rate / 128.0f);
    double se = 0.0, sd = 0.0, prev_l = 0.0, prev_r = 0.0;
    long n = 0;
    for (int b = 0; b < settle + blocks; ++b) {
        for (int i = 0; i < 128; ++i) {
            in_l[static_cast<size_t>(i)] = radio_sample(static_cast<int64_t>(b) * 128 + i, 0);
            in_r[static_cast<size_t>(i)] = radio_sample(static_cast<int64_t>(b) * 128 + i, 1);
        }
        sw_dsp_render(dsp, in_l.data(), in_r.data(), l.data(), r.data(), 128);
        for (int i = 0; i < 128; ++i) {
            const double vl = static_cast<double>(l[static_cast<size_t>(i)]);
            const double vr = static_cast<double>(r[static_cast<size_t>(i)]);
            if (b >= settle) {
                se += vl * vl + vr * vr;
                sd += (vl - prev_l) * (vl - prev_l) + (vr - prev_r) * (vr - prev_r);
                n += 2;
            }
            prev_l = vl;
            prev_r = vr;
        }
    }
    sw_dsp_destroy(dsp);
    return {std::sqrt(se / static_cast<double>(n)), std::sqrt(sd / static_cast<double>(n))};
}

} // namespace

TEST_CASE("dsp_render matches the shipping WASM goldens") {
    for (int s = 0; s < goldens::kDspScriptCount; ++s) {
        const goldens::DspScript& script = goldens::kDspScripts[s];
        INFO("script " << script.label);
        const Rendered r = run_script(script);
        REQUIRE(static_cast<int>(r.excerpt_l.size()) == script.excerpt_count);
        for (int e = 0; e < script.excerpt_count; ++e) {
            INFO("excerpt block " << script.excerpts[e].block);
            int mismatches = 0;
            for (int i = 0; i < goldens::kDspBlock; ++i) {
                if (!bits_equal(r.excerpt_l[static_cast<size_t>(e)][static_cast<size_t>(i)],
                                script.excerpts[e].left[i])) ++mismatches;
                if (!bits_equal(r.excerpt_r[static_cast<size_t>(e)][static_cast<size_t>(i)],
                                script.excerpts[e].right[i])) ++mismatches;
            }
            CHECK(mismatches == 0);
        }
        CHECK(r.checksum == script.checksum);
    }
}

TEST_CASE("dsp_render: how a block is split does not change a bit") {
    const goldens::DspScript& script = goldens::kDspScripts[1];  // 48 kHz, IR swaps
    const uint32_t whole = run_script(script).checksum;
    CHECK(run_script(script, {37, 91}).checksum == whole);
    CHECK(run_script(script, {1, 3, 124}).checksum == whole);
    CHECK(run_script(script, {64}).checksum == whole);
}

TEST_CASE("dsp_render: parameter steps glide (no zipper noise)") {
    // A constant radio input through the identity IR; everything else silent.
    // Stepping the radio gain 0 -> 1 unsmoothed would jump the output by 0.5
    // in one sample; the per-sample one-pole keeps every step tiny.
    sw_dsp* dsp = sw_dsp_create(48000.0f);
    sw_dsp_set_params(dsp, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0.0f, 0.0f, 0.0f, 0.0f, 0);
    std::vector<float> dc(128, 0.5f), l(128), r(128);
    for (int b = 0; b < 400; ++b) sw_dsp_render(dsp, dc.data(), dc.data(), l.data(), r.data(), 128);
    float prev = l[127];
    sw_dsp_set_params(dsp, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0.0f, 0.0f, 0.0f, 1.0f, 0);
    float max_step = 0.0f;
    float peak = 0.0f;
    for (int b = 0; b < 200; ++b) {
        sw_dsp_render(dsp, dc.data(), dc.data(), l.data(), r.data(), 128);
        for (int i = 0; i < 128; ++i) {
            max_step = std::fmax(max_step, std::fabs(l[static_cast<size_t>(i)] - prev));
            peak = std::fmax(peak, std::fabs(l[static_cast<size_t>(i)]));
            prev = l[static_cast<size_t>(i)];
        }
    }
    CHECK(peak > 0.05f);       // the step did come through ...
    CHECK(max_step < 1.0e-3f); // ... as a glide
    sw_dsp_destroy(dsp);
}

TEST_CASE("dsp_render: speed, wet road, wind and rain are audible") {
    Scene stopped;
    Scene cruise;
    cruise.rpm = 2600.0f;
    cruise.load = 0.35f;
    cruise.speed = 25.0f;
    const Levels at_rest = measure(stopped);
    const Levels at_speed = measure(cruise);
    CHECK(at_speed.rms > at_rest.rms * 1.5);

    // Spray in the arches and hiss off the tyres: louder and brighter, even
    // with the cabin sealed.
    Scene wet = cruise;
    wet.wet = 1.0f;
    const Levels soaked = measure(wet);
    CHECK(soaked.rms > at_speed.rms * 1.25);
    CHECK(soaked.hf > at_speed.hf);

    Scene open = cruise;
    open.open = 1.0f;
    Scene windy = open;
    windy.wind = 15.0f;
    CHECK(measure(windy).rms > measure(open).rms * 1.05);

    Scene rain = stopped;
    rain.rain = 1.0f;
    rain.wipers = 1;
    CHECK(measure(rain).rms > at_rest.rms * 1.5);
}

TEST_CASE("dsp_render: the radio changes with the roof and the vehicle") {
    Scene radio;
    radio.rpm = 0.0f;
    radio.radio = 1.0f;
    Scene radio_open = radio;
    radio_open.open = 1.0f;
    Scene limo = radio;
    limo.vehicle = 3;
    limo.ir_taps = 2048;
    const Levels closed = measure(radio);
    const Levels opened = measure(radio_open);
    const Levels limousine = measure(limo);
    // An open roof lets more of the top end through; a different cabin is a
    // different room.
    CHECK(opened.hf > closed.hf * 1.3);
    CHECK(std::fabs(limousine.hf - closed.hf) > closed.hf * 0.05);
}

TEST_CASE("dsp_render: non-finite input never poisons the stream") {
    sw_dsp* dsp = sw_dsp_create(44100.0f);
    const float nan = std::nanf("");
    const float inf = INFINITY;
    sw_dsp_set_params(dsp, nan, nan, inf, nan, 2, nan, inf, nan, nan, 1);
    std::vector<float> taps = {1.0f, nan, inf, 0.25f};
    sw_dsp_set_ir(dsp, taps.data(), static_cast<int>(taps.size()));
    std::vector<float> bad(128, nan), l(128), r(128);
    bad[3] = inf;
    for (int b = 0; b < 50; ++b) sw_dsp_render(dsp, bad.data(), bad.data(), l.data(), r.data(), 128);
    for (int i = 0; i < 128; ++i) {
        CHECK(std::isfinite(l[static_cast<size_t>(i)]));
        CHECK(std::isfinite(r[static_cast<size_t>(i)]));
    }
    sw_dsp_destroy(dsp);
}

TEST_CASE("dsp_*: null and degenerate arguments are safe") {
    sw_dsp_set_params(nullptr, 1.0f, 1.0f, 1.0f, 1.0f, 0, 0.0f, 0.0f, 0.0f, 0.0f, 0);
    sw_dsp_set_ir(nullptr, nullptr, 4);
    sw_dsp_render(nullptr, nullptr, nullptr, nullptr, nullptr, 128);
    sw_dsp_destroy(nullptr);
    CHECK(sw_dsp_max_ir_taps() == goldens::kDspMaxIrTaps);

    sw_dsp* dsp = sw_dsp_create(-5.0f);
    REQUIRE(dsp != nullptr);
    std::vector<float> l(300, 9.0f), r(300, 9.0f);
    sw_dsp_render(dsp, nullptr, nullptr, l.data(), r.data(), 0);
    CHECK(l[0] == 9.0f);
    // More than one quantum per call, null inputs and a null right channel.
    sw_dsp_render(dsp, nullptr, nullptr, l.data(), nullptr, 300);
    CHECK(std::fabs(l[299]) <= 1.0f);
    CHECK(r[0] == 9.0f);
    sw_dsp_destroy(dsp);
}

TEST_CASE("luma_analyze matches the shipping WASM goldens") {
    for (int c = 0; c < goldens::kLumaAnalyzeCaseCount; ++c) {
        const goldens::LumaAnalyzeGolden& g = goldens::kLumaAnalyzeCases[c];
        INFO("case " << c);
        std::vector<unsigned> bins(256, 99u);
        float stats[3] = {-1.0f, -1.0f, -1.0f};
        sw_luma_analyze(goldens::kChoresRgba, goldens::kChoresWidth, goldens::kChoresHeight,
                        g.dst_w, g.dst_h, bins.data(), stats);
        for (int i = 0; i < 256; ++i) CHECK(bins[static_cast<size_t>(i)] == g.bins[i]);
        for (int i = 0; i < 3; ++i) CHECK(bits_equal(stats[i], g.stats[i]));
    }
}

TEST_CASE("luma_analyze: bins equal downsample_2d then luma_histogram_bt709") {
    constexpr int kW = 37;
    constexpr int kH = 23;
    std::vector<unsigned char> rgba(static_cast<size_t>(kW) * kH * 4u);
    uint32_t st = 12345u;
    for (auto& v : rgba) {
        st = st * 1664525u + 1013904223u;
        v = static_cast<unsigned char>(st >> 24);
    }
    const int dw = kW / 4;
    const int dh = kH / 4;
    std::vector<unsigned char> small(static_cast<size_t>(dw) * dh * 4u);
    sw_downsample_2d(rgba.data(), kW, kH, small.data(), dw, dh);
    std::vector<unsigned> expected(256), fused(256);
    sw_luma_histogram_bt709(small.data(), dw, dh, expected.data());
    float stats[3];
    sw_luma_analyze(rgba.data(), kW, kH, dw, dh, fused.data(), stats);
    CHECK(fused == expected);
    CHECK(stats[1] <= stats[0]);
    CHECK(stats[0] <= stats[2]);
}

TEST_CASE("luma_analyze: the mean of a flat 4K frame is exact") {
    // Integer luma summed in uint64: 8.3 M pixels of one colour reduce to that
    // colour's luma with no accumulation error at all.
    constexpr int kW = 3840;
    constexpr int kH = 2160;
    const unsigned char rgb[3] = {201, 37, 118};
    std::vector<unsigned char> rgba(static_cast<size_t>(kW) * kH * 4u);
    for (size_t i = 0; i < rgba.size(); i += 4) {
        rgba[i] = rgb[0];
        rgba[i + 1] = rgb[1];
        rgba[i + 2] = rgb[2];
        rgba[i + 3] = 255;
    }
    std::vector<unsigned> bins(256);
    float stats[3];
    sw_luma_analyze(rgba.data(), kW, kH, kW, kH, bins.data(), stats);
    const double exact = (2126.0 * rgb[0] + 7152.0 * rgb[1] + 722.0 * rgb[2]) / 2550000.0;
    CHECK(stats[0] == static_cast<float>(exact));
    CHECK(stats[0] == stats[1]);
    CHECK(stats[1] == stats[2]);
    unsigned total = 0;
    for (unsigned b : bins) total += b;
    CHECK(total == static_cast<unsigned>(kW * kH));
}

TEST_CASE("luma_analyze: degenerate arguments write zeros") {
    std::vector<unsigned> bins(256, 5u);
    float stats[3] = {7.0f, 7.0f, 7.0f};
    sw_luma_analyze(nullptr, 4, 4, 2, 2, bins.data(), stats);
    CHECK(bins[0] == 0u);
    CHECK(stats[0] == 0.0f);
    const unsigned char px[4] = {255, 255, 255, 255};
    sw_luma_analyze(px, 1, 1, 0, 1, bins.data(), stats);
    CHECK(stats[2] == 0.0f);
    sw_luma_analyze(px, 1, 1, 1, 1, nullptr, stats);  // no crash
}
