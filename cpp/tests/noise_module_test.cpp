/**
 * cpp/tests/noise_module_test.cpp
 *
 * Native (non-Emscripten) golden-vector tests for cpp/src/noise_module.cpp.
 *
 * These run with the *host* compiler — no emcc, no browser, no Node — so a
 * regression in the C++ source of truth is caught by `ctest` on any machine:
 *
 *     cmake -S cpp -B cpp/build-host -DCMAKE_BUILD_TYPE=RelWithDebInfo
 *     cmake --build cpp/build-host
 *     ctest --test-dir cpp/build-host --output-on-failure
 *
 * The expected values in goldens_generated.h are captured from the shipping
 * WASM binary (see scripts/gen-wasm-goldens.mjs), and the identical vectors
 * are asserted against the JS fallback by
 * src/wasm/__tests__/wasmGoldenParity.test.ts. All three implementations are
 * therefore pinned to one contract.
 *
 * On tolerances: the f32 paths are plain IEEE-754 single-precision arithmetic
 * in the same order on both sides, so they are compared bit-exactly. Only
 * haversine gets a relative tolerance — the WAT module calls the host's
 * Math.sin/cos/atan2 while this build uses the platform libm, and the two are
 * allowed to differ in the last places of a double.
 */

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "streetview_wasm.h"
#include "goldens_generated.h"

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace {

/**
 * Bit-exact float comparison. Golden f32 values are round-trip literals of the
 * exact bits the WASM module produced, so anything but equality is drift.
 * NaN never compares equal, which is what we want — no golden is NaN.
 */
bool bit_equal(float a, float b) {
    return std::memcmp(&a, &b, sizeof(float)) == 0;
}

/** Relative difference, with an absolute fallback around zero. */
double rel_diff(double actual, double expected) {
    const double denom = std::fabs(expected);
    return denom > 1e-12 ? std::fabs(actual - expected) / denom
                         : std::fabs(actual - expected);
}

/** Tolerance for the double path (host libm vs the WAT module's host math). */
constexpr double kHaversineRelTolerance = 1e-12;

std::string at(int i) { return "index " + std::to_string(i); }

} // namespace

TEST_CASE("noise2d matches the shipping WASM goldens") {
    sw_seed(goldens::kNoiseSeed);
    for (int i = 0; i < goldens::kNoise2dCount; ++i) {
        INFO(at(i));
        const float actual = sw_noise2d(goldens::kNoise2dX[i], goldens::kNoise2dY[i]);
        CHECK(bit_equal(actual, goldens::kNoise2dExpected[i]));
    }
}

TEST_CASE("noise2d stays inside [-1, 1] over a wide sweep") {
    // Property check on top of the goldens: the gradient vectors are unit
    // length, so no input may push a sample out of range.
    sw_seed(goldens::kNoiseSeed);
    for (int i = -500; i <= 500; ++i) {
        const float x = static_cast<float>(i) * 0.37f;
        const float y = static_cast<float>(-i) * 0.11f;
        const float n = sw_noise2d(x, y);
        CHECK(n >= -1.0f);
        CHECK(n <= 1.0f);
    }
}

TEST_CASE("seeding is deterministic and seed-sensitive") {
    sw_seed(goldens::kNoiseSeed);
    const float a = sw_noise2d(3.25f, -7.5f);
    sw_seed(goldens::kNoiseSeed);
    const float b = sw_noise2d(3.25f, -7.5f);
    CHECK(bit_equal(a, b));

    sw_seed(goldens::kNoiseSeed + 1u);
    const float c = sw_noise2d(3.25f, -7.5f);
    CHECK_FALSE(bit_equal(a, c));

    // Restore the golden permutation for any later test in this file.
    sw_seed(goldens::kNoiseSeed);
}

TEST_CASE("fbm2d matches the shipping WASM goldens") {
    sw_seed(goldens::kNoiseSeed);
    for (int i = 0; i < goldens::kFbm2dCount; ++i) {
        INFO(at(i));
        const float actual = sw_fbm2d(
            goldens::kFbm2dX[i], goldens::kFbm2dY[i],
            goldens::kFbmOctaves, goldens::kFbmLacunarity, goldens::kFbmGain);
        CHECK(bit_equal(actual, goldens::kFbm2dExpected[i]));
    }
}

TEST_CASE("fbm2d returns 0 for a non-positive octave count") {
    sw_seed(goldens::kNoiseSeed);
    CHECK(sw_fbm2d(1.5f, 2.5f, 0, 2.0f, 0.5f) == 0.0f);
    CHECK(sw_fbm2d(1.5f, 2.5f, -3, 2.0f, 0.5f) == 0.0f);
}

TEST_CASE("fill_noise_buffer matches the shipping WASM goldens") {
    sw_seed(goldens::kNoiseSeed);
    const int w = goldens::kNoiseTileWidth;
    const int h = goldens::kNoiseTileHeight;
    std::vector<float> buf(static_cast<size_t>(w) * static_cast<size_t>(h), 0.0f);
    sw_fill_noise_buffer(buf.data(), w, h, goldens::kNoiseTileScale,
                         goldens::kNoiseTileOffsetX, goldens::kNoiseTileOffsetY);
    for (size_t i = 0; i < buf.size(); ++i) {
        INFO(at(static_cast<int>(i)));
        CHECK(bit_equal(buf[i], goldens::kNoiseTileExpected[i]));
    }
}

TEST_CASE("fill_noise_buffer agrees with per-sample noise2d") {
    // The tile loop and the scalar entry point must not drift apart — this is
    // the invariant the SIMD option in CMakeLists.txt has to preserve.
    sw_seed(goldens::kNoiseSeed);
    const int w = goldens::kNoiseTileWidth;
    const int h = goldens::kNoiseTileHeight;
    std::vector<float> buf(static_cast<size_t>(w) * static_cast<size_t>(h), 0.0f);
    sw_fill_noise_buffer(buf.data(), w, h, goldens::kNoiseTileScale,
                         goldens::kNoiseTileOffsetX, goldens::kNoiseTileOffsetY);

    const float inv_scale = 1.0f / goldens::kNoiseTileScale;
    for (int row = 0; row < h; ++row) {
        for (int col = 0; col < w; ++col) {
            const float nx = (static_cast<float>(col) + goldens::kNoiseTileOffsetX) * inv_scale;
            const float ny = (static_cast<float>(row) + goldens::kNoiseTileOffsetY) * inv_scale;
            INFO(at(row * w + col));
            CHECK(bit_equal(buf[static_cast<size_t>(row * w + col)], sw_noise2d(nx, ny)));
        }
    }
}

TEST_CASE("fill_fbm_buffer matches the shipping WASM goldens") {
    sw_seed(goldens::kNoiseSeed);
    const int w = goldens::kFbmTileWidth;
    const int h = goldens::kFbmTileHeight;
    std::vector<float> buf(static_cast<size_t>(w) * static_cast<size_t>(h), 0.0f);
    sw_fill_fbm_buffer(buf.data(), w, h, goldens::kFbmTileScale,
                       goldens::kFbmTileOffsetX, goldens::kFbmTileOffsetY,
                       goldens::kFbmTileOctaves, goldens::kFbmTileLacunarity,
                       goldens::kFbmTileGain);
    for (size_t i = 0; i < buf.size(); ++i) {
        INFO(at(static_cast<int>(i)));
        CHECK(bit_equal(buf[i], goldens::kFbmTileExpected[i]));
    }
}

TEST_CASE("fill_particle_seeds matches the shipping WASM goldens") {
    const int count = goldens::kParticleCount;
    std::vector<float> buf(static_cast<size_t>(count) * 4u, 0.0f);
    sw_fill_particle_seeds(buf.data(), count, goldens::kParticleSeed);
    for (size_t i = 0; i < buf.size(); ++i) {
        INFO(at(static_cast<int>(i)));
        CHECK(bit_equal(buf[i], goldens::kParticleExpected[i]));
    }
}

TEST_CASE("particle seeds respect their documented ranges") {
    const int count = 512;
    std::vector<float> buf(static_cast<size_t>(count) * 4u, 0.0f);
    sw_fill_particle_seeds(buf.data(), count, 0xC0FFEEu);
    for (int i = 0; i < count; ++i) {
        const float* p = buf.data() + static_cast<size_t>(i) * 4u;
        INFO(at(i));
        CHECK(p[0] >= 0.0f); CHECK(p[0] < 1.0f);           // x
        CHECK(p[1] >= 0.0f); CHECK(p[1] < 1.0f);           // y
        CHECK(p[2] >= 0.5f); CHECK(p[2] < 1.5f);           // speed
        CHECK(p[3] >= 0.0f); CHECK(p[3] <= 6.2831854f);    // phase
    }
}

TEST_CASE("haversine matches the shipping WASM goldens") {
    for (int i = 0; i < goldens::kHaversineCount; ++i) {
        INFO(at(i));
        const double actual = sw_haversine(
            goldens::kHaversineLat1[i], goldens::kHaversineLon1[i],
            goldens::kHaversineLat2[i], goldens::kHaversineLon2[i]);
        CHECK(rel_diff(actual, goldens::kHaversineExpected[i]) <= kHaversineRelTolerance);
    }
}

TEST_CASE("haversine is symmetric and zero for identical points") {
    CHECK(sw_haversine(40.7128, -74.006, 40.7128, -74.006) == doctest::Approx(0.0));
    const double ab = sw_haversine(40.7128, -74.006, 51.5074, -0.1278);
    const double ba = sw_haversine(51.5074, -0.1278, 40.7128, -74.006);
    CHECK(rel_diff(ab, ba) <= kHaversineRelTolerance);
}

TEST_CASE("batch_haversine matches the shipping WASM goldens") {
    const int count = goldens::kPolylinePointCount;
    std::vector<double> segments(static_cast<size_t>(count - 1), 0.0);
    const double total = sw_batch_haversine(goldens::kPolylinePoints, count, segments.data());

    for (size_t i = 0; i < segments.size(); ++i) {
        INFO(at(static_cast<int>(i)));
        CHECK(rel_diff(segments[i], goldens::kPolylineExpectedSegments[i])
              <= kHaversineRelTolerance);
    }
    CHECK(rel_diff(total, goldens::kPolylineExpectedTotal) <= kHaversineRelTolerance);
}

TEST_CASE("batch_haversine leaves the output untouched for fewer than two points") {
    // The TS loader short-circuits at count < 2, but the C++ entry point is
    // reachable directly from the WASM ABI, so it must not write out of range.
    const double points[2] = { 40.7128, -74.006 };
    double out[1] = { -1.0 };
    CHECK(sw_batch_haversine(points, 1, out) == 0.0);
    CHECK(out[0] == -1.0);
    CHECK(sw_batch_haversine(points, 0, out) == 0.0);
    CHECK(out[0] == -1.0);
}

TEST_CASE("normalize_angle matches the shipping WASM goldens") {
    for (int i = 0; i < goldens::kNormalizeAngleCount; ++i) {
        INFO(at(i));
        CHECK(bit_equal(sw_normalize_angle(goldens::kNormalizeAngleIn[i]),
                        goldens::kNormalizeAngleExpected[i]));
    }
}

TEST_CASE("normalize_angle always lands in [0, 360)") {
    for (int i = -2000; i <= 2000; ++i) {
        const float a = static_cast<float>(i) * 0.73f;
        const float n = sw_normalize_angle(a);
        INFO(at(i));
        CHECK(n >= 0.0f);
        CHECK(n < 360.0f);
    }
}

TEST_CASE("signed_angle_diff matches the shipping WASM goldens") {
    for (int i = 0; i < goldens::kSignedAngleCount; ++i) {
        INFO(at(i));
        CHECK(bit_equal(sw_signed_angle_diff(goldens::kSignedAngleFrom[i],
                                             goldens::kSignedAngleTo[i]),
                        goldens::kSignedAngleExpected[i]));
    }
}

TEST_CASE("signed_angle_diff stays within [-180, 180]") {
    for (int i = -720; i <= 720; i += 3) {
        const float d = sw_signed_angle_diff(0.0f, static_cast<float>(i));
        INFO(at(i));
        CHECK(d >= -180.0f);
        CHECK(d <= 180.0f);
    }
}

TEST_CASE("fill_engine_noise matches the shipping WASM goldens") {
    struct Case {
        int count;
        float rpm, load, speed, time, sample_rate;
        const float* expected;
    };
    const Case cases[] = {
        { goldens::kEngineCount0, goldens::kEngineRpm0, goldens::kEngineLoad0,
          goldens::kEngineSpeed0, goldens::kEngineTime0, goldens::kEngineSampleRate0,
          goldens::kEngineExpected0 },
        { goldens::kEngineCount1, goldens::kEngineRpm1, goldens::kEngineLoad1,
          goldens::kEngineSpeed1, goldens::kEngineTime1, goldens::kEngineSampleRate1,
          goldens::kEngineExpected1 },
        { goldens::kEngineCount2, goldens::kEngineRpm2, goldens::kEngineLoad2,
          goldens::kEngineSpeed2, goldens::kEngineTime2, goldens::kEngineSampleRate2,
          goldens::kEngineExpected2 },
        { goldens::kEngineCount3, goldens::kEngineRpm3, goldens::kEngineLoad3,
          goldens::kEngineSpeed3, goldens::kEngineTime3, goldens::kEngineSampleRate3,
          goldens::kEngineExpected3 },
    };
    static_assert(sizeof(cases) / sizeof(cases[0]) == goldens::kEngineCaseCount,
                  "engine golden case count drifted from the generated header");

    for (int c = 0; c < goldens::kEngineCaseCount; ++c) {
        const Case& k = cases[c];
        INFO("case " << c);
        std::vector<float> buf(static_cast<size_t>(k.count), 0.0f);
        sw_fill_engine_noise(buf.data(), k.count, k.rpm, k.load, k.speed,
                             k.time, k.sample_rate);
        for (int i = 0; i < k.count; ++i) {
            INFO(at(i));
            CHECK(bit_equal(buf[static_cast<size_t>(i)], k.expected[i]));
        }
    }
}

TEST_CASE("fill_engine_noise clamps to [-1, 1] and tolerates degenerate input") {
    std::vector<float> buf(256, 7.0f);
    sw_fill_engine_noise(buf.data(), static_cast<int>(buf.size()),
                         9000.0f, 1.0f, 400.0f, 99.5f, 44100.0f);
    for (size_t i = 0; i < buf.size(); ++i) {
        INFO(at(static_cast<int>(i)));
        CHECK(buf[i] >= -1.0f);
        CHECK(buf[i] <= 1.0f);
    }

    // Non-positive counts and a null buffer must be no-ops, not crashes.
    buf.assign(buf.size(), 7.0f);
    sw_fill_engine_noise(buf.data(), 0, 2000.0f, 0.5f, 50.0f, 1.0f, 44100.0f);
    CHECK(buf[0] == 7.0f);
    sw_fill_engine_noise(nullptr, 16, 2000.0f, 0.5f, 50.0f, 1.0f, 44100.0f);
}
