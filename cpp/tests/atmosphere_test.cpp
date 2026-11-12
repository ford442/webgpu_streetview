/**
 * cpp/tests/atmosphere_test.cpp
 *
 * Host tests for the atmosphere reference (cpp/src/atmosphere_module.cpp, the
 * atmo_* exports) against the goldens scripts/gen-wasm-goldens.mjs captured
 * from the shipping binary — bit for bit: the integral runs on det_exp, sqrt
 * and floor only, so no libm difference can move it. Plus the physical
 * properties the GPU LUTs rely on.
 */

#include "doctest.h"

#include "streetview/abi.h"
#include "goldens_generated.h"

#include <array>
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

using Params = std::array<float, goldens::kAtmoParamCount>;

Params params_for(double visibility_m, double albedo) {
    Params p{};
    sw_atmo_params(visibility_m, albedo, p.data());
    return p;
}

const float* ray_params() {
    return goldens::kAtmoParamCases[goldens::kAtmoRayParamsCase].expected;
}

} // namespace

TEST_CASE("atmo_param_count is the documented 24") {
    CHECK(sw_atmo_param_count() == 24);
    CHECK(goldens::kAtmoParamCount == 24);
}

TEST_CASE("atmo_params matches the goldens bit for bit") {
    for (const auto& c : goldens::kAtmoParamCases) {
        CAPTURE(c.label);
        const Params p = params_for(c.visibility_m, c.albedo);
        for (size_t i = 0; i < p.size(); ++i) {
            CAPTURE(i);
            CHECK(bits_of(p[i]) == bits_of(c.expected[i]));
        }
    }
}

TEST_CASE("atmo_params: NaN visibility is the unknown default") {
    const Params nan = params_for(std::numeric_limits<double>::quiet_NaN(), 0.3);
    const Params unknown = params_for(-1.0, 0.3);
    CHECK(std::memcmp(nan.data(), unknown.data(), sizeof(nan)) == 0);
}

TEST_CASE("atmo_params: lower visibility means more aerosol") {
    const Params haze = params_for(5000.0, 0.3);
    const Params clear = params_for(50000.0, 0.3);
    CHECK(haze[12] > clear[12]);
    CHECK(haze[23] > clear[23]);
    // Koschmieder: total green extinction at the ground is 3.912 / V.
    CHECK(static_cast<double>(haze[5] + haze[13]) == doctest::Approx(3.912 / 5.0).epsilon(1e-6));
}

TEST_CASE("atmo_transmittance matches the goldens bit for bit") {
    for (const auto& c : goldens::kAtmoRays) {
        CAPTURE(c.altitude_m);
        CAPTURE(c.cos_zenith);
        float out[3] = {-1.0f, -1.0f, -1.0f};
        sw_atmo_transmittance(ray_params(), c.altitude_m, c.cos_zenith, out);
        for (size_t ch = 0; ch < 3; ++ch) CHECK(bits_of(out[ch]) == bits_of(c.expected[ch]));
    }
}

TEST_CASE("atmo_transmittance: in (0, 1], falls toward the horizon, red survives longest") {
    float zenith[3];
    float slant[3];
    sw_atmo_transmittance(ray_params(), 0.0, 1.0, zenith);
    sw_atmo_transmittance(ray_params(), 0.0, 0.2, slant);
    for (size_t ch = 0; ch < 3; ++ch) {
        CHECK(zenith[ch] > 0.0f);
        CHECK(zenith[ch] <= 1.0f);
        CHECK(slant[ch] < zenith[ch]);
    }
    CHECK(zenith[0] > zenith[1]);
    CHECK(zenith[1] > zenith[2]);
    // At the top of the atmosphere looking up, nothing is left to cross.
    float top[3];
    sw_atmo_transmittance(ray_params(), 1e9, 1.0, top);
    for (float v : top) CHECK(v == 1.0f);
}

TEST_CASE("atmo_transmittance_lut matches the goldens bit for bit") {
    std::vector<float> lut(
        static_cast<size_t>(goldens::kAtmoLutWidth * goldens::kAtmoLutHeight * 4), -1.0f);
    sw_atmo_transmittance_lut(ray_params(), goldens::kAtmoLutWidth, goldens::kAtmoLutHeight,
                              lut.data());
    for (size_t i = 0; i < lut.size(); ++i) {
        CAPTURE(i);
        CHECK(bits_of(lut[i]) == bits_of(goldens::kAtmoLutExpected[i]));
    }
}

TEST_CASE("atmo_transmittance_lut: the zenith texel at the ground is the zenith ray") {
    // Row 0 is the ground; x_mu = 0 is d = d_min, straight up.
    std::vector<float> lut(static_cast<size_t>(goldens::kAtmoLutWidth * 4));
    sw_atmo_transmittance_lut(ray_params(), goldens::kAtmoLutWidth, 1, lut.data());
    float zenith[3];
    sw_atmo_transmittance(ray_params(), 0.0, 1.0, zenith);
    for (size_t ch = 0; ch < 3; ++ch) CHECK(bits_of(lut[ch]) == bits_of(zenith[ch]));
    CHECK(lut[3] == 1.0f);
}

TEST_CASE("atmo_sun_color matches the goldens bit for bit") {
    for (const auto& c : goldens::kAtmoSun) {
        CAPTURE(c.altitude_m);
        CAPTURE(c.sin_elevation);
        float out[3] = {-1.0f, -1.0f, -1.0f};
        sw_atmo_sun_color(ray_params(), c.sin_elevation, c.altitude_m, out);
        for (size_t ch = 0; ch < 3; ++ch) CHECK(bits_of(out[ch]) == bits_of(c.expected[ch]));
    }
}

TEST_CASE("atmo_sun_color: reddens as it sets, black once the disk is below the horizon") {
    float high[3];
    float low[3];
    float gone[3];
    sw_atmo_sun_color(ray_params(), 0.5, 0.0, high);
    sw_atmo_sun_color(ray_params(), 0.0349, 0.0, low);
    sw_atmo_sun_color(ray_params(), -0.01, 0.0, gone);
    CHECK(low[0] / low[2] > high[0] / high[2]);
    for (float v : gone) CHECK(v == 0.0f);
}

TEST_CASE("atmo_*: null pointers and empty LUTs are no-ops") {
    sw_atmo_params(1000.0, 0.3, nullptr);
    float out[3] = {7.0f, 7.0f, 7.0f};
    sw_atmo_transmittance(nullptr, 0.0, 1.0, out);
    sw_atmo_sun_color(nullptr, 0.5, 0.0, out);
    sw_atmo_transmittance_lut(ray_params(), 0, 4, out);
    for (float v : out) CHECK(v == 7.0f);
    sw_atmo_transmittance(ray_params(), 0.0, 1.0, nullptr);
    sw_atmo_transmittance_lut(nullptr, 4, 4, out);
}
