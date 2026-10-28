/**
 * cpp/tests/depth_test.cpp
 *
 * Host tests for the scene-depth kernels (cpp/src/depth_module.cpp, the
 * depth_* exports DepthController runs per inference) against the goldens
 * scripts/gen-wasm-goldens.mjs captured from the shipping scalar binary. Both
 * binaries are held to the same vectors by
 * src/wasm/__tests__/wasmGoldenParity.test.ts.
 */

#include "doctest.h"

#include "streetview/abi.h"
#include "goldens_generated.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace {

uint32_t bits_of(float v) {
    uint32_t u = 0;
    std::memcpy(&u, &v, sizeof(u));
    return u;
}

uint64_t bits_of(double v) {
    uint64_t u = 0;
    std::memcpy(&u, &v, sizeof(u));
    return u;
}

constexpr int kDepthTexels = goldens::kDepthWidth * goldens::kDepthHeight;

/** A golden map with the documented NaN / +Infinity texels poked in. */
std::vector<float> depth_input(const float* values) {
    std::vector<float> map(values, values + kDepthTexels);
    for (int i : goldens::kDepthNanIndices)
        map[static_cast<size_t>(i)] = std::numeric_limits<float>::quiet_NaN();
    for (int i : goldens::kDepthInfIndices)
        map[static_cast<size_t>(i)] = std::numeric_limits<float>::infinity();
    return map;
}

} // namespace

TEST_CASE("depth_percentiles matches the goldens bit for bit") {
    for (const auto& c : goldens::kDepthPercentileCases) {
        CAPTURE(c.label);
        std::vector<float> in;
        if (c.values) {
            in = depth_input(c.values);
        } else {
            in.resize(static_cast<size_t>(goldens::kDepthStridedCount));
            for (int i = 0; i < goldens::kDepthStridedCount; ++i) {
                in[static_cast<size_t>(i)] =
                    static_cast<float>(static_cast<double>((i * 7919) % 10007) / 10007.0);
            }
        }
        double out[2] = {-1.0, -1.0};
        sw_depth_percentiles(in.data(), static_cast<int>(in.size()), c.low, c.high, out);
        CHECK(bits_of(out[0]) == bits_of(c.expected[0]));
        CHECK(bits_of(out[1]) == bits_of(c.expected[1]));
    }
}

TEST_CASE("depth_percentiles: nothing finite reads as an empty range") {
    const float nan = std::numeric_limits<float>::quiet_NaN();
    std::vector<float> in(64, nan);
    double out[2] = {-1.0, -1.0};
    sw_depth_percentiles(in.data(), static_cast<int>(in.size()), 0.02, 0.98, out);
    CHECK(out[0] == 0.0);
    CHECK(out[1] == 0.0);
}

TEST_CASE("depth_percentiles: the radix select reads what a sort would") {
    // Negatives, duplicates, a tiny range and huge magnitudes: every byte of
    // the order key gets exercised.
    uint32_t rng = 0x9e3779b9U;
    const auto next = [&rng] {
        rng ^= rng << 13;
        rng ^= rng >> 17;
        rng ^= rng << 5;
        return rng;
    };
    for (int trial = 0; trial < 40; ++trial) {
        CAPTURE(trial);
        const size_t n = 1 + next() % 3000;
        std::vector<float> in(n);
        for (float& v : in) {
            const uint32_t r = next();
            switch (r % 4) {
            case 0: v = static_cast<float>(static_cast<int>(r % 7) - 3); break;
            case 1:
                v = static_cast<float>(static_cast<double>(r) / 4294967296.0 * 2.0 - 1.0);
                break;
            case 2: v = static_cast<float>(static_cast<double>(r % 1000) * 1e30); break;
            default: v = 1.0f + static_cast<float>(r % 16) * 1.1920929e-7f; break;
            }
        }
        std::vector<float> sorted = in;
        std::sort(sorted.begin(), sorted.end());
        for (const double pct : {0.0, 0.02, 0.5, 0.98, 1.0}) {
            const double last = static_cast<double>(n - 1);
            const auto k =
                static_cast<size_t>(std::min(last, std::max(0.0, std::round(pct * last))));
            double out[2] = {-1.0, -1.0};
            sw_depth_percentiles(in.data(), static_cast<int>(n), pct, pct, out);
            CHECK(out[0] == static_cast<double>(sorted[k]));
        }
    }
}

TEST_CASE("depth_normalize walks the golden sequence bit for bit") {
    double state[3] = {0.0, 0.0, 0.0};
    std::vector<float> previous;
    std::vector<float> out(static_cast<size_t>(kDepthTexels));
    for (const auto& step : goldens::kDepthSteps) {
        CAPTURE(step.label);
        const std::vector<float> in = depth_input(step.values);
        const float* prev = step.aligned != 0 && !previous.empty() ? previous.data() : nullptr;
        sw_depth_normalize(in.data(), kDepthTexels, goldens::kDepthWidth, goldens::kDepthHeight,
                           step.horizon_y, step.aligned, step.same_scene, state, prev, out.data());
        for (int i = 0; i < kDepthTexels; ++i) {
            CAPTURE(i);
            REQUIRE(bits_of(out[static_cast<size_t>(i)]) == bits_of(step.expected[i]));
        }
        for (int k = 0; k < 3; ++k) CHECK(bits_of(state[k]) == bits_of(step.expected_state[k]));
        previous = out;
    }
}

TEST_CASE("depth_normalize stays on the proxy scale: [0, 1], non-finite texels far") {
    double state[3] = {0.0, 0.0, 0.0};
    const std::vector<float> in = depth_input(goldens::kDepthSteps[0].values);
    std::vector<float> out(static_cast<size_t>(kDepthTexels));
    sw_depth_normalize(in.data(), kDepthTexels, goldens::kDepthWidth, goldens::kDepthHeight, 0.45,
                       0, 0, state, nullptr, out.data());
    for (float v : out) {
        CHECK(v >= 0.0f);
        CHECK(v <= 1.0f);
    }
    for (int i : goldens::kDepthNanIndices) CHECK(out[static_cast<size_t>(i)] == 1.0f);
    CHECK(state[2] >= 0.04);
    CHECK(state[2] <= 0.3);
}

TEST_CASE("depth_near_depth matches the goldens bit for bit") {
    for (const auto& c : goldens::kDepthNearCases) {
        CAPTURE(c.label);
        const double q = sw_depth_near_depth(goldens::kDepthNearMap, goldens::kDepthWidth,
                                             goldens::kDepthHeight, c.horizon_y);
        CHECK(bits_of(q) == bits_of(c.expected));
    }
    CHECK(sw_depth_near_depth(nullptr, 4, 4, 0.5) == 0.1);
}
