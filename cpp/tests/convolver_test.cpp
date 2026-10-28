/**
 * cpp/tests/convolver_test.cpp
 *
 * The cabin convolver's pieces against references that share none of their
 * code: the 256-point FFT (streetview/fft256.h) against a naive f64 DFT, and
 * the whole UPOLS path through the public dsp_* API against a f64 direct
 * convolution of the dry (identity-IR) render — including what an IR swap
 * does, and that it never clicks. Runs on every host build, and on the SIMD
 * path through SIMDe (streetview_simd_tests).
 */

#include "doctest.h"

#include "streetview/abi.h"
#include "streetview/fft256.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace {

constexpr int kN = sv_fft::kN;
constexpr int kBlock = 128;
/**
 * Compare from here on: the direct partition's glide (1024 frames) is over and
 * the DC blocker (20 Hz, ~8 ms) has forgotten it — 6000 samples is e^-12 of it.
 */
constexpr size_t kSettled = 6000;

inline double d(float v) {
    return static_cast<double>(v);
}

/** Deterministic noise in [-1, 1). */
float noise(uint32_t& state) {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(state >> 8) * (1.0f / 8388608.0f) - 1.0f;
}

double max_abs(const std::vector<float>& v, size_t from = 0) {
    double m = 0.0;
    for (size_t i = from; i < v.size(); ++i) m = std::fmax(m, std::fabs(static_cast<double>(v[i])));
    return m;
}

struct Stereo {
    std::vector<float> l;
    std::vector<float> r;
};

/**
 * Render `blocks` quanta of the bed with the radio as the only loud source
 * (a deterministic noise input), calling `at_block(b, dsp)` first each block.
 */
template <typename F> Stereo render(int blocks, F&& at_block, float sample_rate = 48000.0f) {
    sw_dsp* dsp = sw_dsp_create(sample_rate);
    REQUIRE(dsp != nullptr);
    // Radio only, at a fixed gain the smoother has reached before we compare.
    sw_dsp_set_params(dsp, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0.0f, 0.0f, 0.0f, 0.25f, 0);
    std::vector<float> in_l(kBlock), in_r(kBlock), out_l(kBlock), out_r(kBlock);
    Stereo out;
    uint32_t seed = 12345u;
    for (int b = 0; b < blocks; ++b) {
        at_block(b, dsp);
        for (int i = 0; i < kBlock; ++i) {
            in_l[static_cast<size_t>(i)] = noise(seed);
            in_r[static_cast<size_t>(i)] = noise(seed);
        }
        sw_dsp_render(dsp, in_l.data(), in_r.data(), out_l.data(), out_r.data(), kBlock);
        out.l.insert(out.l.end(), out_l.begin(), out_l.end());
        out.r.insert(out.r.end(), out_r.begin(), out_r.end());
    }
    sw_dsp_destroy(dsp);
    return out;
}

/** A decaying noise IR (like fill_cabin_ir's tail, but independent of it). */
std::vector<float> test_ir(int taps, uint32_t seed) {
    std::vector<float> h(static_cast<size_t>(taps));
    double env = 0.6;
    const double decay = std::pow(1e-3, 1.0 / taps);
    for (int t = 0; t < taps; ++t) {
        h[static_cast<size_t>(t)] = static_cast<float>(env * d(noise(seed)));
        env *= decay;
    }
    h[0] = 0.5f;
    // Unit L1 norm: the wet bed is never louder than the dry one (no clamp).
    double l1 = 0.0;
    for (float v : h) l1 += std::fabs(static_cast<double>(v));
    for (float& v : h) v = static_cast<float>(static_cast<double>(v) / l1);
    return h;
}

/** y[n] = sum_t h[t] x[n - t] in f64. */
double conv_at(const std::vector<float>& h, const std::vector<float>& x, size_t n) {
    double acc = 0.0;
    for (size_t t = 0; t < h.size() && t <= n; ++t) {
        acc += d(h[t]) * d(x[n - t]);
    }
    return acc;
}

} // namespace

TEST_CASE("fft256: twiddles are cos/sin(2 pi k / 256) rounded once") {
    for (int k = 0; k < kN; ++k) {
        const double a = 2.0 * 3.14159265358979323846 * k / kN;
        INFO("k = " << k);
        // Within half an f32 ulp of 1 of libm (exact zeros where libm says 6e-17).
        CHECK(std::fabs(d(sv_fft::detail::kTw.cos[k]) - std::cos(a)) <= 3e-8);
        CHECK(std::fabs(d(sv_fft::detail::kTw.sin[k]) - std::sin(a)) <= 3e-8);
    }
}

TEST_CASE("fft256 matches a naive f64 DFT") {
    std::vector<float> re(kN), im(kN), tr(kN), ti(kN);
    uint32_t seed = 7u;
    for (int n = 0; n < kN; ++n) {
        re[static_cast<size_t>(n)] = noise(seed);
        im[static_cast<size_t>(n)] = noise(seed);
    }
    const std::vector<float> x_re = re, x_im = im;
    sv_fft::fft256(re.data(), im.data(), tr.data(), ti.data());
    double worst = 0.0;
    for (int k = 0; k < kN; ++k) {
        double sr = 0.0, si = 0.0;
        for (int n = 0; n < kN; ++n) {
            const double a = -2.0 * 3.14159265358979323846 * ((k * n) % kN) / kN;
            const double c = std::cos(a), s = std::sin(a);
            const double xr = d(x_re[static_cast<size_t>(n)]);
            const double xi = d(x_im[static_cast<size_t>(n)]);
            sr += xr * c - xi * s;
            si += xr * s + xi * c;
        }
        worst = std::fmax(worst, std::fabs(sr - d(re[static_cast<size_t>(k)])));
        worst = std::fmax(worst, std::fabs(si - d(im[static_cast<size_t>(k)])));
    }
    // |X| ~ sqrt(256) for unit noise; f32 FFT error is a few ulps of that.
    CHECK(worst < 2e-4);
}

TEST_CASE("fft256: the swapped transform inverts it") {
    std::vector<float> re(kN), im(kN), tr(kN), ti(kN);
    uint32_t seed = 99u;
    for (int n = 0; n < kN; ++n) {
        re[static_cast<size_t>(n)] = noise(seed);
        im[static_cast<size_t>(n)] = noise(seed);
    }
    const std::vector<float> x_re = re, x_im = im;
    sv_fft::fft256(re.data(), im.data(), tr.data(), ti.data());
    sv_fft::fft256(im.data(), re.data(), tr.data(), ti.data());
    for (int n = 0; n < kN; ++n) {
        CHECK(d(re[static_cast<size_t>(n)]) / kN ==
              doctest::Approx(d(x_re[static_cast<size_t>(n)])).epsilon(1e-5));
        CHECK(d(im[static_cast<size_t>(n)]) / kN ==
              doctest::Approx(d(x_im[static_cast<size_t>(n)])).epsilon(1e-5));
    }
}

TEST_CASE("dsp convolver: UPOLS output is the direct convolution of the dry bed") {
    for (const int taps : {128, 300, 2048, 5000}) {
        INFO("taps = " << taps);
        const std::vector<float> h = test_ir(taps, static_cast<uint32_t>(taps));
        const int blocks = 60 + taps / kBlock;
        // Dry: the identity IR, settled since dsp_create.
        const Stereo dry = render(blocks, [](int, sw_dsp*) {});
        const Stereo wet = render(blocks, [&](int b, sw_dsp* dsp) {
            if (b == 0) sw_dsp_set_ir(dsp, h.data(), taps);
        });
        // The convolution is linear and commutes with the DC blocker, so
        // wet = h * dry once the glide has settled. The bed stays far from
        // the +-1 clamp here.
        REQUIRE(max_abs(dry.l) < 0.9);
        REQUIRE(max_abs(wet.l) < 0.9);
        double worst = 0.0;
        double peak = 0.0;
        for (size_t n = kSettled; n < wet.l.size(); ++n) {
            const double el = conv_at(h, dry.l, n);
            const double er = conv_at(h, dry.r, n);
            worst = std::fmax(worst, std::fabs(el - d(wet.l[n])));
            worst = std::fmax(worst, std::fabs(er - d(wet.r[n])));
            peak = std::fmax(peak, std::fabs(el));
        }
        CHECK(peak > 0.01);
        CHECK(worst < 2e-5 * (1.0 + peak));
    }
}

TEST_CASE(
    "dsp convolver: an IR swap convolves old input with the old room, new input with the new") {
    const int taps = 1024;
    const std::vector<float> h1 = test_ir(taps, 1u);
    const std::vector<float> h2 = test_ir(taps, 2u);
    const int swap = 20;
    const int blocks = swap + 70;
    const Stereo dry = render(blocks, [](int, sw_dsp*) {});
    const Stereo wet = render(blocks, [&](int b, sw_dsp* dsp) {
        if (b == 0) sw_dsp_set_ir(dsp, h1.data(), taps);
        if (b == swap) sw_dsp_set_ir(dsp, h2.data(), taps);
    });
    // Once the glide is over, the tail of input before the swap still comes
    // from h1 and everything else from h2.
    const size_t at = static_cast<size_t>(swap * kBlock);
    double worst = 0.0;
    for (size_t n = at + kSettled; n < wet.l.size(); ++n) {
        double expected = 0.0;
        for (size_t t = 0; t < static_cast<size_t>(taps) && t <= n; ++t) {
            const size_t m = n - t;
            const std::vector<float>& h = (m < at && t >= static_cast<size_t>(kBlock)) ? h1 : h2;
            expected += d(h[t]) * d(dry.l[m]);
        }
        worst = std::fmax(worst, std::fabs(expected - d(wet.l[n])));
    }
    CHECK(worst < 1e-4);
}

TEST_CASE("dsp convolver: an IR swap does not click") {
    // A steady sine through two very different rooms (a dry unit impulse and
    // a dense 2048-tap tail, both at most unit gain): the largest
    // sample-to-sample step while the room changes stays near the larger of
    // the two rooms' steady-state steps — no discontinuity from the swap.
    const int taps = 2048;
    std::vector<float> bright(static_cast<size_t>(taps), 0.0f);
    const std::vector<float> dark = test_ir(taps, 5u);
    bright[0] = 1.0f;
    sw_dsp* dsp = sw_dsp_create(48000.0f);
    REQUIRE(dsp != nullptr);
    sw_dsp_set_params(dsp, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0.0f, 0.0f, 0.0f, 1.0f, 0);
    std::vector<float> in(kBlock), l(kBlock), r(kBlock);
    double before = 0.0, across = 0.0, after = 0.0;
    float prev = 0.0f;
    int64_t k = 0;
    for (int b = 0; b < 200; ++b) {
        if (b == 20) sw_dsp_set_ir(dsp, bright.data(), taps);
        if (b == 100) sw_dsp_set_ir(dsp, dark.data(), taps);
        for (int i = 0; i < kBlock; ++i, ++k) {
            in[static_cast<size_t>(i)] =
                static_cast<float>(0.5 * std::sin(0.05 * static_cast<double>(k)));
        }
        sw_dsp_render(dsp, in.data(), in.data(), l.data(), r.data(), kBlock);
        for (int i = 0; i < kBlock; ++i) {
            const double step = std::fabs(d(l[static_cast<size_t>(i)]) - d(prev));
            prev = l[static_cast<size_t>(i)];
            if (b >= 80 && b < 100) before = std::fmax(before, step);
            if (b >= 100 && b < 140) across = std::fmax(across, step);
            if (b >= 180) after = std::fmax(after, step);
        }
    }
    sw_dsp_destroy(dsp);
    INFO("before " << before << " across " << across << " after " << after);
    CHECK(before > 0.0);
    CHECK(after > 0.0);
    CHECK(across < 1.25 * std::fmax(before, after));
}

TEST_CASE("dsp convolver: dsp_max_ir_taps taps are accepted, more truncate") {
    const int max = sw_dsp_max_ir_taps();
    CHECK(max == 16384);
    std::vector<float> h(static_cast<size_t>(max) + 500, 0.001f);
    h[0] = 0.5f;
    sw_dsp* dsp = sw_dsp_create(44100.0f);
    REQUIRE(dsp != nullptr);
    sw_dsp_set_ir(dsp, h.data(), static_cast<int>(h.size()));
    std::vector<float> l(1000), r(1000);
    for (int i = 0; i < 200; ++i) sw_dsp_render(dsp, nullptr, nullptr, l.data(), r.data(), 1000);
    for (float v : l) CHECK(std::isfinite(v));
    sw_dsp_destroy(dsp);
}
