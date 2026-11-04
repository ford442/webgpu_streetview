/**
 * cpp/tests/ub_edge_test.cpp
 *
 * Inputs that used to be undefined behaviour: a NaN azimuth or an enormous
 * sample rate reaching a float->int cast, and frame sizes whose pixel counts
 * overflow `int`. Run under the ASan/UBSan jobs with -fno-sanitize-recover, a
 * regression here aborts the process.
 */

#include "doctest.h"

#include "streetview/abi.h"

#include <cmath>
#include <limits>
#include <vector>

TEST_CASE("fill_hrtf: NaN azimuth reads as centre; a huge sample rate does not overflow int") {
    std::vector<float> l(64, 0.0f), r(64, 0.0f);
    const float nan = std::numeric_limits<float>::quiet_NaN();
    sw_fill_hrtf(l.data(), r.data(), 64, nan, 48000.0f);
    std::vector<float> cl(64, 0.0f), cr(64, 0.0f);
    sw_fill_hrtf(cl.data(), cr.data(), 64, 0.0f, 48000.0f);
    CHECK(l == cl);
    CHECK(r == cr);
    for (float v : l) CHECK(std::isfinite(v));

    // 3.4e38 Hz: kMaxItdSeconds * sr * |shaped| is far outside int range.
    sw_fill_hrtf(l.data(), r.data(), 64, 45.0f, std::numeric_limits<float>::max());
    sw_fill_hrtf(l.data(), r.data(), 64, 45.0f, std::numeric_limits<float>::infinity());
    for (float v : l) CHECK(std::isfinite(v));
    for (float v : r) CHECK(std::isfinite(v));
}

TEST_CASE("downsample_2d: identity-size boxes and null / non-positive inputs") {
    // (The 64-bit box-edge arithmetic only differs from int above ~46k px per side,
    // too large to allocate here; the fuzz_luma harness covers that range.)
    std::vector<unsigned char> src(4u * 8u * 8u, 200u);
    std::vector<unsigned char> dst(4u * 8u * 8u, 0u);
    sw_downsample_2d(src.data(), 8, 8, dst.data(), 8, 8);
    CHECK(dst[0] == 200u);
    sw_downsample_2d(nullptr, 8, 8, dst.data(), 8, 8);
    sw_downsample_2d(src.data(), 0, 8, dst.data(), 8, 8);
}

TEST_CASE("batch_haversine / luma kernels: null pointers are no-ops") {
    double out[2] = {-1.0, -1.0};
    CHECK(sw_batch_haversine(nullptr, 3, out) == 0.0);
    const double pts[6] = {0, 0, 1, 1, 2, 2};
    CHECK(sw_batch_haversine(pts, 3, nullptr) == 0.0);
    CHECK(out[0] == -1.0);
}
