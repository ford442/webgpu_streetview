/**
 * cpp/tests/vehicle_test.cpp
 *
 * Host tests for the vehicle model (cpp/src/vehicle_module.cpp, the veh_*
 * exports) against the goldens scripts/gen-wasm-goldens.mjs captured from the
 * shipping binary: every variant's params block and seven scripted drives,
 * replayed sample by sample and compared exactly (the model is IEEE
 * add/sub/mul/div and sqrt only, so no libm difference can move it). Plus
 * the properties the TS layer relies on: batching invariance, the brake as
 * friction, the pawl, and finite output on hostile input.
 */

#include "doctest.h"

#include "streetview/abi.h"
#include "goldens_generated.h"

#include <cmath>
#include <cstddef>
#include <limits>
#include <span>
#include <vector>

namespace {

using Block = std::vector<double>;

/** Exact equality; +0 and -0 compare equal (the JSON goldens cannot tell them apart). */
bool same(double a, double b) {
    return a == b || (std::isnan(a) && std::isnan(b));
}

Block params_for(int variant) {
    Block p(static_cast<size_t>(sw_veh_param_count()));
    sw_veh_params(variant, p.data());
    return p;
}

Block telemetry(const Block& p, const Block& s) {
    Block t(static_cast<size_t>(sw_veh_telemetry_count()));
    sw_veh_telemetry(p.data(), s.data(), t.data());
    return t;
}

Block fresh_state(const Block& p, double speed, int selector, unsigned seed) {
    Block s(static_cast<size_t>(sw_veh_state_count()));
    sw_veh_reset(p.data(), s.data(), speed, selector, seed);
    return s;
}

/** Inputs block: [mode, target, throttle, brake, selector, yaw, roughness, grade]. */
Block pedals(double throttle, double brake, double selector = 3.0) {
    return {1.0, 0.0, throttle, brake, selector, 0.0, 0.3, 0.0};
}
Block target(double speed, double selector = 3.0) {
    return {0.0, speed, 0.0, 0.0, selector, 0.0, 0.3, 0.0};
}

void run(const Block& p, Block& s, const Block& u, int steps, double dt = 1.0 / 120.0) {
    sw_veh_step(p.data(), s.data(), u.data(), dt, steps);
}

} // namespace

TEST_CASE("veh_* block sizes are the documented ones") {
    CHECK(sw_veh_param_count() == 64);
    CHECK(sw_veh_state_count() == 32);
    CHECK(sw_veh_input_count() == 8);
    CHECK(sw_veh_telemetry_count() == 24);
    CHECK(sw_veh_variant_count() == 4);
    CHECK(goldens::kVehParamCount == sw_veh_param_count());
    CHECK(goldens::kVehStateCount == sw_veh_state_count());
    CHECK(goldens::kVehInputCount == sw_veh_input_count());
    CHECK(goldens::kVehTelemetryCount == sw_veh_telemetry_count());
    CHECK(goldens::kVehVariantCount == sw_veh_variant_count());
}

TEST_CASE("veh_params matches the goldens for every variant; unknown is the sedan") {
    const std::span<const double> all(goldens::kVehParams);
    for (int v = 0; v < goldens::kVehVariantCount; ++v) {
        CAPTURE(v);
        const Block p = params_for(v);
        const auto expected = all.subspan(static_cast<size_t>(v) * p.size(), p.size());
        for (size_t i = 0; i < p.size(); ++i) {
            CAPTURE(i);
            CHECK(same(p[i], expected[i]));
        }
    }
    CHECK(params_for(-1) == params_for(0));
    CHECK(params_for(99) == params_for(0));
}

TEST_CASE("veh_step replays every golden drive exactly") {
    for (const auto& sc : goldens::kVehScenarios) {
        CAPTURE(sc.label);
        const Block p = params_for(sc.variant);
        Block s = fresh_state(p, sc.speed_mps, sc.selector, sc.seed);
        const std::span<const goldens::VehPhase> phases(sc.phases,
                                                        static_cast<size_t>(sc.phase_count));
        const std::span<const double> samples(sc.samples, static_cast<size_t>(sc.sample_count) *
                                                              goldens::kVehTelemetryCount);
        size_t sample = 0;
        for (const auto& ph : phases) {
            const Block u(std::begin(ph.inputs), std::end(ph.inputs));
            for (int done = 0; done < ph.steps; done += sc.sample_steps) {
                run(p, s, u, sc.sample_steps, sc.dt);
                const Block t = telemetry(p, s);
                for (size_t i = 0; i < t.size(); ++i) {
                    CAPTURE(sample);
                    CAPTURE(i);
                    CHECK(same(t[i], samples[sample * t.size() + i]));
                }
                ++sample;
            }
        }
        CHECK(sample == static_cast<size_t>(sc.sample_count));
        const std::span<const double> final_state(sc.final_state, s.size());
        for (size_t i = 0; i < s.size(); ++i) {
            CAPTURE(i);
            CHECK(same(s[i], final_state[i]));
        }
    }
}

TEST_CASE("veh_step: n steps in one call equal n calls of one step (n <= 240)") {
    const Block p = params_for(1);
    Block a = fresh_state(p, 10.0, 3, 42);
    Block b = a;
    const Block u = pedals(0.7, 0.0);
    run(p, a, u, 200);
    for (int i = 0; i < 200; ++i) run(p, b, u, 1);
    CHECK(a == b);
}

TEST_CASE("veh_step: the brake stops the car and never pushes it backwards") {
    const Block p = params_for(0);
    Block s = fresh_state(p, 25.0, 3, 1);
    double prev = 25.0;
    for (int i = 0; i < 600; ++i) {
        run(p, s, pedals(0.0, 1.0), 1);
        const double v = telemetry(p, s)[0];
        CHECK(v >= 0.0);
        CHECK(v <= prev);
        prev = v;
    }
    CHECK(telemetry(p, s)[0] == 0.0);
}

TEST_CASE("veh_step: P holds the car with the pawl; N decouples the engine") {
    const Block p = params_for(0);
    Block s = fresh_state(p, 0.0, 0, 1);
    run(p, s, pedals(1.0, 0.0, 0.0), 240); // full throttle in P
    Block t = telemetry(p, s);
    CHECK(t[0] == 0.0);
    CHECK(t[3] == 0.0);
    CHECK(t[2] > 5000.0); // it revs freely
    s = fresh_state(p, 0.0, 2, 1);
    run(p, s, pedals(0.0, 0.0, 2.0), 240);
    t = telemetry(p, s);
    CHECK(t[0] == 0.0);
    CHECK(t[2] == doctest::Approx(800.0).epsilon(0.05)); // idle
}

TEST_CASE("veh_step: R drives backwards; D from reverse stops first") {
    const Block p = params_for(0);
    Block s = fresh_state(p, 0.0, 1, 1);
    for (int i = 0; i < 5; ++i) run(p, s, target(2.0, 1.0), 240);
    Block t = telemetry(p, s);
    CHECK(t[0] == doctest::Approx(-2.0).epsilon(0.05));
    CHECK(t[3] == -1.0);
    run(p, s, target(5.0, 3.0), 30);
    t = telemetry(p, s);
    CHECK(t[0] > -2.0); // braking towards zero, not yet forward
    for (int i = 0; i < 5; ++i) run(p, s, target(5.0, 3.0), 240);
    CHECK(telemetry(p, s)[0] == doctest::Approx(5.0).epsilon(0.05));
}

TEST_CASE("veh_step: the target-speed driver settles on the target") {
    for (int v = 0; v < sw_veh_variant_count(); ++v) {
        CAPTURE(v);
        const Block p = params_for(v);
        Block s = fresh_state(p, 0.0, 3, 9);
        for (int i = 0; i < 8; ++i) run(p, s, target(15.0), 240);
        CHECK(telemetry(p, s)[0] == doctest::Approx(15.0).epsilon(0.02));
    }
}

TEST_CASE("veh_step: braking pitches the nose down, a left turn rolls the body right") {
    const Block p = params_for(2);
    Block s = fresh_state(p, 20.0, 3, 1);
    run(p, s, pedals(0.0, 0.8), 60);
    CHECK(telemetry(p, s)[10] < 0.0);
    s = fresh_state(p, 20.0, 3, 1);
    Block u = target(20.0);
    u[5] = 0.3; // + yaw = left
    run(p, s, u, 240);
    CHECK(telemetry(p, s)[12] > 0.0);
}

TEST_CASE("veh_step: a still car on a rough road has a still body") {
    const Block p = params_for(0);
    Block s = fresh_state(p, 0.0, 3, 5);
    Block u = target(0.0);
    u[6] = 1.0;
    run(p, s, u, 240);
    const Block t = telemetry(p, s);
    CHECK(t[11] == 0.0);
    CHECK(std::fabs(t[12]) == 0.0);
}

TEST_CASE("veh_* tolerate NaN, infinities and null pointers") {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double inf = std::numeric_limits<double>::infinity();
    const Block p = params_for(0);
    Block s = fresh_state(p, nan, 3, 1);
    const Block u = {nan, nan, nan, nan, nan, inf, -inf, nan};
    run(p, s, u, 240);
    run(p, s, {1.0, inf, inf, -inf, 3.0, nan, nan, inf}, 240);
    for (double x : s) CHECK(std::isfinite(x));
    for (double x : telemetry(p, s)) CHECK(std::isfinite(x));
    const Block before = s;
    run(p, s, u, 10, nan); // dt NaN: no-op
    run(p, s, u, 10, -1.0);
    run(p, s, u, -5);
    CHECK(s == before);
    sw_veh_params(0, nullptr);
    sw_veh_reset(nullptr, s.data(), 0.0, 3, 1);
    sw_veh_reset(p.data(), nullptr, 0.0, 3, 1);
    sw_veh_step(nullptr, s.data(), u.data(), 0.01, 1);
    sw_veh_step(p.data(), nullptr, u.data(), 0.01, 1);
    sw_veh_step(p.data(), s.data(), nullptr, 0.01, 1);
    sw_veh_telemetry(p.data(), s.data(), nullptr);
    CHECK(s == before);
}
