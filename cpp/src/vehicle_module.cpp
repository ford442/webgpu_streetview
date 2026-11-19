/**
 * vehicle_module.cpp
 * The car's physics: a fixed-step longitudinal + ride model (veh_* exports).
 *
 * Street View movement is discrete (panorama hops), so the hop/cruise layer
 * only knows a *target speed*; this model supplies everything else — what the
 * cabin engine hears, what the gauges show and (later) how the body moves:
 *
 *   longitudinal  a throttle that lags the pedal; an engine torque curve
 *                 (table) with friction, an idle governor and a rev limiter;
 *                 a torque converter (capacity C0 from the stall speed, torque
 *                 multiplication below the coupling point) with a lockup
 *                 clutch; an automatic gearbox (throttle-dependent shift map,
 *                 kickdown, torque interruption while a shift runs); aero drag,
 *                 rolling resistance, grade and a friction-like brake.
 *   driver        in target-speed mode, a PI controller with a resistance
 *                 feed-forward turns the target into throttle/brake (the pedal
 *                 mode takes them from the caller: wheels and pads, later).
 *   ride          pitch, heave and roll as damped springs: pitch driven by
 *                 the longitudinal acceleration, roll by the lateral one (speed
 *                 x yaw rate), heave and a roll share by a road profile that
 *                 is a function of distance travelled (still car: still body).
 *
 * The caller owns everything: the params block (sw_veh_params per variant),
 * the state (sw_veh_reset) and the inputs, all flat arrays of doubles that the
 * loader copies through its scratch arena. Kernels never allocate. The step is
 * fixed (the caller runs the accumulator and passes 1/120 s and a step count),
 * so a 30 Hz and a 144 Hz display integrate the same trajectory.
 *
 * Determinism: the goldens are bit-exact on every build (emcc SIMD and scalar,
 * g++, clang, x86-64-v3). Only IEEE add/sub/mul/div, sqrt and comparisons —
 * no libm transcendental anywhere — under -ffp-contract=off; the road profile
 * comes from a xorshift32 held in the state.
 */

#include "streetview/abi.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

namespace {

constexpr int kParamCount = 64;
constexpr int kStateCount = 32;
constexpr int kInputCount = 8;
constexpr int kTelemetryCount = 24;
constexpr int kVariantCount = 4;
constexpr int kMaxGears = 8;
constexpr int kTorqueBins = 8;
/** Steps one veh_step call may run (a stalled tab is the caller's problem). */
constexpr int kMaxStepsPerCall = 240;

constexpr double kGravity = 9.80665;
constexpr double kAirDensity = 1.225;
constexpr double kRadPerSecToRpm = 9.5492965855137201;  // 60 / (2 pi)
constexpr double kRpmToRadPerSec = 0.10471975511965977; // 2 pi / 60
constexpr double kTwoPi = 6.2831853071795865;
/** Largest acceleration (m/s^2, 1.5 g) that drives the body springs. */
constexpr double kMaxBodyAccel = 14.7;

// ---------------------------------------------------------------------------
// Params block (doubles). abi.h documents the same layout.
// ---------------------------------------------------------------------------
namespace prm {
constexpr size_t mass = 0;         // kg
constexpr size_t cda = 1;          // drag coefficient x frontal area, m^2
constexpr size_t crr = 2;          // rolling resistance coefficient
constexpr size_t wheel_radius = 3; // m
constexpr size_t final_drive = 4;  // axle ratio
constexpr size_t gear_count = 5;   // forward gears, 1..8
constexpr size_t gear_ratio0 = 6;  // [6..13] forward ratios, 1st first
constexpr size_t reverse_ratio = 14;
constexpr size_t engine_inertia = 15; // kg m^2 (engine + converter pump)
constexpr size_t idle_rpm = 16;
constexpr size_t redline_rpm = 17;
constexpr size_t torque_rpm_step = 18; // bins at 0, step, 2 step, ... rpm
constexpr size_t torque0 = 19;         // [19..26] full-load torque, N m
constexpr size_t friction0 = 27;       // engine friction at 0 rpm, N m
constexpr size_t friction_per_krpm = 28;
constexpr size_t throttle_tau = 29; // s, pedal -> effective throttle
constexpr size_t brake_tau = 30;    // s
constexpr size_t stall_rpm = 31;    // converter stall speed at the peak torque
constexpr size_t stall_torque_ratio = 32;
constexpr size_t coupling_ratio = 33; // speed ratio where multiplication ends
constexpr size_t lockup_gear = 34;    // lowest gear the lockup clutch closes in
constexpr size_t lockup_speed = 35;   // m/s
constexpr size_t up_rpm_light = 36;   // upshift turbine rpm at zero pedal
constexpr size_t up_rpm_full = 37;    // ... at full pedal
constexpr size_t down_rpm_light = 38;
constexpr size_t down_rpm_full = 39;
constexpr size_t shift_time = 40;     // s of torque interruption
constexpr size_t shift_interval = 41; // s between two shifts
constexpr size_t kickdown_pedal = 42;
constexpr size_t shift_torque_factor = 43; // drive torque kept while shifting
constexpr size_t brake_decel = 44;         // m/s^2 at full brake
constexpr size_t driveline_eff = 45;
constexpr size_t pitch_hz = 46;
constexpr size_t pitch_zeta = 47;
constexpr size_t pitch_gain = 48; // rad per m/s^2 of longitudinal acceleration
constexpr size_t heave_hz = 49;
constexpr size_t heave_zeta = 50;
constexpr size_t roll_hz = 51;
constexpr size_t roll_zeta = 52;
constexpr size_t roll_gain = 53;        // rad per m/s^2 of lateral acceleration
constexpr size_t road_amplitude = 54;   // m of road profile at roughness 1
constexpr size_t road_length = 55;      // m between road profile knots
constexpr size_t road_roll_share = 56;  // rad of roll per m of profile
constexpr size_t driver_kp = 57;        // 1/s
constexpr size_t driver_ki = 58;        // effort trim gain, 1/s
constexpr size_t driver_accel = 59;     // m/s^2 the target-speed driver asks at most
constexpr size_t driver_decel = 60;     // m/s^2
constexpr size_t driver_accel_ref = 61; // m/s^2 that full pedal is assumed to give
// [62..63] reserved (0)
} // namespace prm

// ---------------------------------------------------------------------------
// State block (doubles).
// ---------------------------------------------------------------------------
namespace st {
constexpr size_t speed = 0; // m/s, signed: + forward
constexpr size_t distance = 1;
constexpr size_t omega_e = 2; // engine, rad/s
constexpr size_t throttle = 3;
constexpr size_t brake = 4;
constexpr size_t gear = 5; // -1 reverse, 0 decoupled (P/N), 1..n
constexpr size_t shift_timer = 6;
constexpr size_t since_shift = 7;
constexpr size_t lockup = 8;
constexpr size_t pitch = 9;
constexpr size_t pitch_rate = 10;
constexpr size_t heave = 11;
constexpr size_t heave_rate = 12;
constexpr size_t roll = 13;
constexpr size_t roll_rate = 14;
constexpr size_t road_phase = 15; // fraction of the current profile segment
constexpr size_t road_prev = 16;
constexpr size_t road_next = 17;
constexpr size_t road_roll_prev = 18;
constexpr size_t road_roll_next = 19;
constexpr size_t rng = 20; // xorshift32, held exactly in a double
constexpr size_t accel = 21;
constexpr size_t lat_accel = 22;
constexpr size_t integral = 23; // the driver's effort trim
constexpr size_t load = 24;
constexpr size_t engine_torque = 25;
constexpr size_t drive_force = 26;
constexpr size_t shift_count = 27;
constexpr size_t time = 28;
constexpr size_t selector = 29;
constexpr size_t omega_t = 30;  // turbine, rad/s
constexpr size_t kickdown = 31; // 0 pedal below, 1 armed, 2 spent
} // namespace st

namespace in {
constexpr size_t mode = 0; // 0 target speed, 1 pedals
constexpr size_t target_speed = 1;
constexpr size_t throttle = 2;
constexpr size_t brake = 3;
constexpr size_t selector = 4; // 0 P, 1 R, 2 N, 3 D
constexpr size_t yaw_rate = 5; // rad/s, + turning left
constexpr size_t roughness = 6;
constexpr size_t grade = 7; // rise / run, + uphill
} // namespace in

constexpr int kSelPark = 0;
constexpr int kSelReverse = 1;
constexpr int kSelNeutral = 2;
constexpr int kSelDrive = 3;

using Params = std::span<const double, kParamCount>;
using State = std::span<double, kStateCount>;
using Inputs = std::span<const double, kInputCount>;

double clamp(double v, double lo, double hi) {
    if (!(v > lo)) return lo; // also NaN -> lo
    return v < hi ? v : hi;
}
double clamp01(double v) {
    return clamp(v, 0.0, 1.0);
}
double absd(double v) {
    return v < 0.0 ? -v : v;
}
double lerp(double a, double b, double t) {
    return a + (b - a) * t;
}
double finite_or(double v, double fallback) {
    // NaN fails both comparisons; so do the infinities.
    return (v > -1e300 && v < 1e300) ? v : fallback;
}

/** One vehicle variant, as named fields: veh_params flattens it. */
struct Variant {
    double mass, cda, crr, wheel_radius, final_drive;
    int gears;
    double ratios[kMaxGears];
    double reverse_ratio, engine_inertia, idle_rpm, redline_rpm, torque_rpm_step;
    double torque[kTorqueBins];
    double friction0, friction_per_krpm, throttle_tau, brake_tau;
    double stall_rpm, stall_torque_ratio, coupling_ratio, lockup_gear, lockup_speed;
    double up_light, up_full, down_light, down_full, shift_time, shift_interval, kickdown;
    double shift_torque_factor, brake_decel, driveline_eff;
    double pitch_hz, pitch_zeta, pitch_gain, heave_hz, heave_zeta, roll_hz, roll_zeta, roll_gain;
    double road_amplitude, road_length, road_roll_share;
    double driver_kp, driver_ki, driver_accel, driver_decel, driver_accel_ref;
};

// The parameter sheets (docs/VEHICLE.md lists the performance each one is
// held to by src/car/vehicle/vehicleSim.wasm.test.ts).
constexpr Variant kVariants[kVariantCount] = {
    // 0: sedan — a 2.0 l turbo four, six-speed automatic.
    {
        .mass = 1500.0,
        .cda = 0.68,
        .crr = 0.011,
        .wheel_radius = 0.316,
        .final_drive = 3.42,
        .gears = 6,
        .ratios = {4.15, 2.37, 1.56, 1.16, 0.86, 0.69, 0.0, 0.0},
        .reverse_ratio = 3.40,
        .engine_inertia = 0.20,
        .idle_rpm = 800.0,
        .redline_rpm = 6500.0,
        .torque_rpm_step = 1000.0,
        .torque = {90.0, 170.0, 235.0, 265.0, 265.0, 255.0, 235.0, 190.0},
        .friction0 = 12.0,
        .friction_per_krpm = 4.0,
        .throttle_tau = 0.12,
        .brake_tau = 0.10,
        .stall_rpm = 2300.0,
        .stall_torque_ratio = 2.0,
        .coupling_ratio = 0.85,
        .lockup_gear = 3.0,
        .lockup_speed = 14.0,
        .up_light = 2100.0,
        .up_full = 6200.0,
        .down_light = 1200.0,
        .down_full = 3000.0,
        .shift_time = 0.30,
        .shift_interval = 0.70,
        .kickdown = 0.90,
        .shift_torque_factor = 0.35,
        .brake_decel = 9.5,
        .driveline_eff = 0.90,
        .pitch_hz = 1.4,
        .pitch_zeta = 0.65,
        .pitch_gain = 0.0045,
        .heave_hz = 1.5,
        .heave_zeta = 0.55,
        .roll_hz = 1.1,
        .roll_zeta = 0.60,
        .roll_gain = 0.0060,
        .road_amplitude = 0.006,
        .road_length = 0.6,
        .road_roll_share = 0.8,
        .driver_kp = 1.0,
        .driver_ki = 1.5,
        .driver_accel = 2.8,
        .driver_decel = 3.5,
        .driver_accel_ref = 3.0,
    },
    // 1: sports — a free-revving six, close ratios, stiff springs.
    {
        .mass = 1420.0,
        .cda = 0.62,
        .crr = 0.010,
        .wheel_radius = 0.330,
        .final_drive = 3.15,
        .gears = 6,
        .ratios = {3.60, 2.19, 1.41, 1.00, 0.83, 0.69, 0.0, 0.0},
        .reverse_ratio = 3.20,
        .engine_inertia = 0.17,
        .idle_rpm = 900.0,
        .redline_rpm = 7200.0,
        .torque_rpm_step = 1000.0,
        .torque = {120.0, 230.0, 330.0, 380.0, 400.0, 400.0, 390.0, 350.0},
        .friction0 = 14.0,
        .friction_per_krpm = 4.5,
        .throttle_tau = 0.08,
        .brake_tau = 0.08,
        .stall_rpm = 2600.0,
        .stall_torque_ratio = 1.8,
        .coupling_ratio = 0.88,
        .lockup_gear = 2.0,
        .lockup_speed = 12.0,
        .up_light = 2400.0,
        .up_full = 7000.0,
        .down_light = 1500.0,
        .down_full = 3800.0,
        .shift_time = 0.18,
        .shift_interval = 0.45,
        .kickdown = 0.85,
        .shift_torque_factor = 0.45,
        .brake_decel = 10.5,
        .driveline_eff = 0.92,
        .pitch_hz = 1.8,
        .pitch_zeta = 0.70,
        .pitch_gain = 0.0030,
        .heave_hz = 1.9,
        .heave_zeta = 0.60,
        .roll_hz = 1.5,
        .roll_zeta = 0.70,
        .roll_gain = 0.0040,
        .road_amplitude = 0.005,
        .road_length = 0.6,
        .road_roll_share = 1.0,
        .driver_kp = 1.2,
        .driver_ki = 1.8,
        .driver_accel = 3.6,
        .driver_decel = 4.0,
        .driver_accel_ref = 4.5,
    },
    // 2: limousine — a heavy V8 with soft, under-damped springs (it wallows).
    {
        .mass = 2700.0,
        .cda = 0.95,
        .crr = 0.012,
        .wheel_radius = 0.340,
        .final_drive = 3.07,
        .gears = 6,
        .ratios = {4.25, 2.53, 1.67, 1.24, 1.00, 0.83, 0.0, 0.0},
        .reverse_ratio = 3.60,
        .engine_inertia = 0.28,
        .idle_rpm = 650.0,
        .redline_rpm = 6000.0,
        .torque_rpm_step = 1000.0,
        .torque = {150.0, 260.0, 370.0, 420.0, 430.0, 420.0, 390.0, 330.0},
        .friction0 = 16.0,
        .friction_per_krpm = 5.0,
        .throttle_tau = 0.18,
        .brake_tau = 0.14,
        .stall_rpm = 2000.0,
        .stall_torque_ratio = 2.2,
        .coupling_ratio = 0.84,
        .lockup_gear = 3.0,
        .lockup_speed = 13.0,
        .up_light = 1700.0,
        .up_full = 5500.0,
        .down_light = 1000.0,
        .down_full = 2400.0,
        .shift_time = 0.45,
        .shift_interval = 0.90,
        .kickdown = 0.92,
        .shift_torque_factor = 0.30,
        .brake_decel = 8.5,
        .driveline_eff = 0.88,
        .pitch_hz = 0.9,
        .pitch_zeta = 0.35,
        .pitch_gain = 0.0075,
        .heave_hz = 1.0,
        .heave_zeta = 0.30,
        .roll_hz = 0.8,
        .roll_zeta = 0.35,
        .roll_gain = 0.0100,
        .road_amplitude = 0.007,
        .road_length = 0.7,
        .road_roll_share = 0.6,
        .driver_kp = 0.8,
        .driver_ki = 1.2,
        .driver_accel = 2.0,
        .driver_decel = 3.0,
        .driver_accel_ref = 2.2,
    },
    // 3: van — the science lab: a big diesel, five speeds, tall and boxy.
    {
        .mass = 3200.0,
        .cda = 1.90,
        .crr = 0.013,
        .wheel_radius = 0.360,
        .final_drive = 3.92,
        .gears = 5,
        .ratios = {3.75, 2.26, 1.51, 1.00, 0.73, 0.0, 0.0, 0.0},
        .reverse_ratio = 3.50,
        .engine_inertia = 0.32,
        .idle_rpm = 700.0,
        .redline_rpm = 4500.0,
        .torque_rpm_step = 1000.0,
        .torque = {200.0, 300.0, 380.0, 400.0, 390.0, 360.0, 320.0, 250.0},
        .friction0 = 18.0,
        .friction_per_krpm = 6.0,
        .throttle_tau = 0.20,
        .brake_tau = 0.14,
        .stall_rpm = 1900.0,
        .stall_torque_ratio = 2.1,
        .coupling_ratio = 0.85,
        .lockup_gear = 3.0,
        .lockup_speed = 13.0,
        .up_light = 1600.0,
        .up_full = 4000.0,
        .down_light = 1000.0,
        .down_full = 2000.0,
        .shift_time = 0.40,
        .shift_interval = 0.90,
        .kickdown = 0.92,
        .shift_torque_factor = 0.30,
        .brake_decel = 7.5,
        .driveline_eff = 0.88,
        .pitch_hz = 1.1,
        .pitch_zeta = 0.45,
        .pitch_gain = 0.0060,
        .heave_hz = 1.2,
        .heave_zeta = 0.40,
        .roll_hz = 0.9,
        .roll_zeta = 0.40,
        .roll_gain = 0.0120,
        .road_amplitude = 0.008,
        .road_length = 0.7,
        .road_roll_share = 0.9,
        .driver_kp = 0.8,
        .driver_ki = 1.2,
        .driver_accel = 1.8,
        .driver_decel = 3.0,
        .driver_accel_ref = 1.8,
    },
};

/** Forward gear count, clamped to [1, 8]. */
int gear_count(Params p) {
    const double g = p[prm::gear_count];
    if (!(g >= 1.0)) return 1;
    if (g >= static_cast<double>(kMaxGears)) return kMaxGears;
    return static_cast<int>(g);
}

/** Signed overall ratio (gearbox x axle) of gear g; 0 when decoupled. */
double overall_ratio(Params p, int g) {
    if (g == 0) return 0.0;
    if (g < 0) return -p[prm::reverse_ratio] * p[prm::final_drive];
    return p[prm::gear_ratio0 + static_cast<size_t>(g - 1)] * p[prm::final_drive];
}

/** Full-load torque at `rpm` (linear between bins, flat past the last). */
double full_load_torque(Params p, double rpm) {
    const double step = p[prm::torque_rpm_step] > 1.0 ? p[prm::torque_rpm_step] : 1000.0;
    const double x = rpm > 0.0 ? rpm / step : 0.0;
    if (!(x < static_cast<double>(kTorqueBins - 1))) return p[prm::torque0 + kTorqueBins - 1];
    const int i = static_cast<int>(x);
    const double f = x - static_cast<double>(i);
    const size_t at = prm::torque0 + static_cast<size_t>(i);
    return lerp(p[at], p[at + 1], f);
}

double friction_torque(Params p, double rpm) {
    return p[prm::friction0] + p[prm::friction_per_krpm] * (rpm > 0.0 ? rpm : 0.0) * 1e-3;
}

double peak_torque(Params p) {
    double peak = 0.0;
    for (size_t i = 0; i < kTorqueBins; ++i) {
        if (p[prm::torque0 + i] > peak) peak = p[prm::torque0 + i];
    }
    return peak;
}

/**
 * Converter capacity C0 (N m per (rad/s)^2): the pump absorbs the peak torque
 * at the stall speed with the turbine held. Pump torque is
 * C0 (w_e|w_e| - w_t|w_t|), which is C0 w_e^2 (1 - SR^2) while driving and
 * turns negative on the overrun (engine braking through the fluid).
 */
double converter_capacity(Params p) {
    const double w = p[prm::stall_rpm] * kRpmToRadPerSec;
    return w > 1.0 ? peak_torque(p) / (w * w) : 0.0;
}

/** Turbine rpm of gear g at road speed v (m/s), for the shift map. */
double turbine_rpm(Params p, int g, double v) {
    const double r = p[prm::wheel_radius];
    return absd(v * overall_ratio(p, g) / r) * kRadPerSecToRpm;
}

uint32_t xorshift32(uint32_t x) {
    x ^= x << 13U;
    x ^= x >> 17U;
    x ^= x << 5U;
    return x;
}

/** Next road knot in [-1, 1) from the state's generator. */
double next_knot(State s) {
    auto x = static_cast<uint32_t>(s[st::rng]);
    if (x == 0U) x = 0x9E3779B9U;
    x = xorshift32(x);
    s[st::rng] = static_cast<double>(x);
    return static_cast<double>(x) * (2.0 / 4294967296.0) - 1.0;
}

/** Selector from an input double: anything unknown is Drive. */
int selector_of(double v) {
    if (v == 0.0) return kSelPark;
    if (v == 1.0) return kSelReverse;
    if (v == 2.0) return kSelNeutral;
    return kSelDrive;
}

/** Highest forward gear whose turbine rpm stays above the light downshift line. */
int gear_for_speed(Params p, double v) {
    const int n = gear_count(p);
    for (int g = n; g > 1; --g) {
        if (turbine_rpm(p, g, v) >= p[prm::down_rpm_light] + 300.0) return g;
    }
    return 1;
}

void begin_shift(Params p, State s, int to) {
    s[st::gear] = static_cast<double>(to);
    s[st::shift_timer] = p[prm::shift_time];
    s[st::since_shift] = 0.0;
    s[st::lockup] = 0.0;
    s[st::shift_count] += 1.0;
}

/**
 * The target-speed driver -> (throttle, brake). It asks for an acceleration
 * (P on the speed error, clamped to the variant's comfort limits), turns it
 * into a signed pedal effort by feed-forward (drag, rolling, grade over the
 * acceleration full pedal is taken to give) and trims that by integrating the
 * error between the asked and the measured acceleration — which adapts to
 * the gear and the converter and leaves no steady-state speed error. Effort
 * above 0 is throttle; below the coast band it is brake.
 */
void drive_to_target(Params p, State s, Inputs u, int sel, double h, double& thr, double& brk) {
    thr = 0.0;
    brk = 0.0;
    const double m = p[prm::mass];
    const double dir = sel == kSelReverse ? -1.0 : 1.0;
    const double v = s[st::speed] * dir; // along the selected direction
    double target = clamp(finite_or(u[in::target_speed], 0.0), 0.0, 90.0);
    if (sel == kSelPark || sel == kSelNeutral) target = 0.0;
    if (sel == kSelPark || v < -0.3) { // parked, or rolling the wrong way: stop first
        brk = 1.0;
        s[st::integral] = 0.0;
        return;
    }
    if (target < 0.05 && v < 0.3) { // hold at rest
        brk = 0.6;
        s[st::integral] = 0.0;
        return;
    }
    const double ref = p[prm::driver_accel_ref] > 0.1 ? p[prm::driver_accel_ref] : 0.1;
    const double demand =
        clamp(p[prm::driver_kp] * (target - v), -p[prm::driver_decel], p[prm::driver_accel]);
    // The trim learns while the drivetrain is connected and not mid-shift
    // (a shift's torque dip is not the driver's error).
    if (sel == kSelDrive || sel == kSelReverse) {
        if (!(s[st::shift_timer] > 0.0)) {
            const double a_meas = s[st::accel] * dir;
            s[st::integral] =
                clamp(s[st::integral] + p[prm::driver_ki] * (demand - a_meas) * h / ref, -0.6, 0.6);
        }
    } else {
        s[st::integral] = 0.0;
    }
    const double resist =
        (0.5 * kAirDensity * p[prm::cda] * v * v) / m + p[prm::crr] * kGravity * clamp01(v / 0.3);
    const double grade = clamp(finite_or(u[in::grade], 0.0), -0.5, 0.5);
    const double effort = (demand + resist + kGravity * grade) / ref + s[st::integral];
    // Coast band: a little deceleration is the car's own (drag, the engine).
    const double coast = 0.4 / ref;
    if (sel != kSelNeutral && effort > 0.0) {
        thr = clamp01(effort);
    } else if (effort < -coast) {
        brk = clamp01((-effort - coast) * ref / p[prm::brake_decel]);
    }
}

/** The automatic: shift map, kickdown, selector changes. */
void gearbox(Params p, State s, int sel, double pedal, double h) {
    const double v = s[st::speed];
    const int n = gear_count(p);
    auto g = static_cast<int>(s[st::gear]);
    s[st::since_shift] += h;
    if (s[st::shift_timer] > 0.0) {
        s[st::shift_timer] -= h;
        if (s[st::shift_timer] < 0.0) s[st::shift_timer] = 0.0;
    }
    if (sel == kSelPark || sel == kSelNeutral) {
        if (g != 0) {
            s[st::gear] = 0.0;
            s[st::lockup] = 0.0;
        }
        return;
    }
    if (sel == kSelReverse) {
        if (g != -1) begin_shift(p, s, -1);
        return;
    }
    // Drive.
    if (g <= 0) {
        begin_shift(p, s, gear_for_speed(p, v > 0.0 ? v : 0.0));
        return;
    }
    if (g > n) g = n;
    if (v < 1.0 && g > 1) { // stopping: straight back to first
        begin_shift(p, s, 1);
        return;
    }
    // Kickdown is an event, not a state: it arms when the pedal crosses the
    // threshold and fires once (at full pedal near top speed it would hunt).
    const double t = clamp01(pedal);
    if (t < p[prm::kickdown_pedal]) {
        s[st::kickdown] = 0.0;
    } else if (s[st::kickdown] == 0.0) {
        s[st::kickdown] = 1.0;
    }
    if (s[st::shift_timer] > 0.0 || s[st::since_shift] < p[prm::shift_interval]) return;
    const double up = lerp(p[prm::up_rpm_light], p[prm::up_rpm_full], t);
    const double down = lerp(p[prm::down_rpm_light], p[prm::down_rpm_full], t);
    const double vf = v > 0.0 ? v : 0.0;
    const double rpm = turbine_rpm(p, g, vf);
    if (s[st::kickdown] == 1.0) {
        s[st::kickdown] = 2.0;
        // Kickdown: the lowest gear that stays clear of the upshift line.
        int k = g;
        while (k > 1 && turbine_rpm(p, k - 1, vf) < up - 300.0) --k;
        if (k < g) {
            begin_shift(p, s, k);
            return;
        }
    }
    // Hysteresis: never up into a gear below the light downshift line, never
    // down into one above the upshift line.
    if (g < n && rpm > up && turbine_rpm(p, g + 1, vf) > p[prm::down_rpm_light] + 200.0) {
        begin_shift(p, s, g + 1);
    } else if (g > 1 && rpm < down && turbine_rpm(p, g - 1, vf) < up - 600.0) {
        begin_shift(p, s, g - 1);
    }
}

/** Road profile (a function of distance) and the ride springs. */
void ride(Params p, State s, Inputs u, double h) {
    const double v = s[st::speed];
    const double len = p[prm::road_length] > 0.05 ? p[prm::road_length] : 0.05;
    s[st::road_phase] += absd(v) * h / len;
    for (int i = 0; i < 4 && s[st::road_phase] >= 1.0; ++i) {
        s[st::road_phase] -= 1.0;
        s[st::road_prev] = s[st::road_next];
        s[st::road_next] = next_knot(s);
        s[st::road_roll_prev] = s[st::road_roll_next];
        s[st::road_roll_next] = next_knot(s);
    }
    if (s[st::road_phase] >= 1.0) s[st::road_phase] = 0.0;
    const double ph = s[st::road_phase];
    const double w = ph * ph * (3.0 - 2.0 * ph); // C1 between knots
    const double rough = clamp01(finite_or(u[in::roughness], 0.0));
    const double amp = p[prm::road_amplitude] * rough;
    const double road = amp * lerp(s[st::road_prev], s[st::road_next], w);
    const double road_roll =
        amp * p[prm::road_roll_share] * lerp(s[st::road_roll_prev], s[st::road_roll_next], w);

    const double yaw = clamp(finite_or(u[in::yaw_rate], 0.0), -3.0, 3.0);
    // Tyres hold ~1 g: no input drives the body harder than kMaxBodyAccel.
    const double ay = clamp(v * yaw, -kMaxBodyAccel, kMaxBodyAccel);
    s[st::lat_accel] = ay;
    const double ax = clamp(s[st::accel], -kMaxBodyAccel, kMaxBodyAccel);

    // Semi-implicit Euler: rate first, then the position with the new rate.
    const auto spring = [h](double& x, double& xd, double target, double hz, double zeta) {
        const double wn = kTwoPi * hz;
        const double acc = wn * wn * (target - x) - 2.0 * zeta * wn * xd;
        xd += acc * h;
        x += xd * h;
    };
    double pitch = s[st::pitch];
    double pitch_rate = s[st::pitch_rate];
    spring(pitch, pitch_rate, p[prm::pitch_gain] * ax, p[prm::pitch_hz], p[prm::pitch_zeta]);
    double heave = s[st::heave];
    double heave_rate = s[st::heave_rate];
    spring(heave, heave_rate, road, p[prm::heave_hz], p[prm::heave_zeta]);
    double roll = s[st::roll];
    double roll_rate = s[st::roll_rate];
    // + roll = right side down: a left turn (+ yaw, + ay) leans the body right.
    spring(roll, roll_rate, p[prm::roll_gain] * ay + road_roll, p[prm::roll_hz], p[prm::roll_zeta]);
    s[st::pitch] = pitch;
    s[st::pitch_rate] = pitch_rate;
    s[st::heave] = heave;
    s[st::heave_rate] = heave_rate;
    s[st::roll] = roll;
    s[st::roll_rate] = roll_rate;
}

void step_once(Params p, State s, Inputs u, double h) {
    const double m = p[prm::mass];
    const double r = p[prm::wheel_radius];
    const double je = p[prm::engine_inertia] > 0.01 ? p[prm::engine_inertia] : 0.01;
    const int sel = selector_of(u[in::selector]);
    s[st::selector] = static_cast<double>(sel);

    // 1. Pedals: the caller's, or the target-speed driver's.
    double thr_cmd = 0.0;
    double brk_cmd = 0.0;
    if (u[in::mode] == 1.0) {
        thr_cmd = clamp01(finite_or(u[in::throttle], 0.0));
        brk_cmd = clamp01(finite_or(u[in::brake], 0.0));
        if (sel == kSelPark) brk_cmd = 1.0;
    } else {
        drive_to_target(p, s, u, sel, h, thr_cmd, brk_cmd);
    }
    // First-order lags (explicit, h < tau for every variant).
    s[st::throttle] += (thr_cmd - s[st::throttle]) * clamp01(h / p[prm::throttle_tau]);
    s[st::brake] += (brk_cmd - s[st::brake]) * clamp01(h / p[prm::brake_tau]);

    // 2. Gearbox.
    gearbox(p, s, sel, thr_cmd, h);
    const auto g = static_cast<int>(s[st::gear]);
    const double ratio = overall_ratio(p, g);
    const double v = s[st::speed];
    const double omega_t = v * ratio / r;
    s[st::omega_t] = omega_t;

    // 3. Lockup clutch: closes in a high gear at speed, never while shifting
    // or under kickdown-level pedal.
    const bool shifting = s[st::shift_timer] > 0.0;
    double omega_e = s[st::omega_e];
    if (s[st::lockup] != 0.0) {
        if (shifting || g < static_cast<int>(p[prm::lockup_gear]) ||
            v < p[prm::lockup_speed] - 2.0 || thr_cmd >= p[prm::kickdown_pedal]) {
            s[st::lockup] = 0.0;
        }
    } else if (!shifting && g >= static_cast<int>(p[prm::lockup_gear]) &&
               v >= p[prm::lockup_speed] && thr_cmd < p[prm::kickdown_pedal] && omega_e > 1.0 &&
               omega_t > 0.9 * omega_e) {
        s[st::lockup] = 1.0;
        omega_e = omega_t;
    }
    const bool locked = s[st::lockup] != 0.0;

    // 4. Engine: idle governor, rev limiter, friction.
    const double rpm = omega_e * kRadPerSecToRpm;
    const double t_max = full_load_torque(p, rpm);
    const double t_fric = friction_torque(p, rpm);
    const double idle_w = p[prm::idle_rpm] * kRpmToRadPerSec;
    const double idle_ff =
        t_max > 1.0 ? friction_torque(p, p[prm::idle_rpm]) / full_load_torque(p, p[prm::idle_rpm])
                    : 0.0;
    const double idle_thr = clamp(idle_ff + (idle_w - omega_e) * 0.05, 0.0, 0.5);
    double eng_thr = s[st::throttle] > idle_thr ? s[st::throttle] : idle_thr;
    if (rpm > p[prm::redline_rpm]) eng_thr = 0.0; // fuel cut
    const double t_eng = eng_thr * t_max - t_fric;
    s[st::load] = eng_thr;
    s[st::engine_torque] = t_eng;

    // 5. Driveline force at the wheels.
    const double eff = p[prm::driveline_eff];
    const double shift_k = shifting ? p[prm::shift_torque_factor] : 1.0;
    double f_drive = 0.0;
    double m_eff = m * 1.04; // wheels and driveline
    if (g == 0) {
        omega_e += h * t_eng / je;
    } else if (locked) {
        f_drive = t_eng * ratio * eff * shift_k / r;
        m_eff += je * (ratio * ratio) / (r * r);
    } else {
        const double c0 = converter_capacity(p);
        const double t_pump = c0 * (omega_e * absd(omega_e) - omega_t * absd(omega_t));
        double tr = 1.0;
        if (t_pump > 0.0 && omega_e > 1.0) {
            const double sr = clamp01(omega_t / omega_e);
            const double cp = p[prm::coupling_ratio];
            if (sr < cp) tr = lerp(p[prm::stall_torque_ratio], 1.0, sr / cp);
        }
        f_drive = t_pump * tr * ratio * eff * shift_k / r;
        omega_e += h * (t_eng - t_pump) / je;
    }
    if (omega_e < 0.0) omega_e = 0.0;
    const double omega_cap = p[prm::redline_rpm] * 1.1 * kRpmToRadPerSec;
    if (omega_e > omega_cap) omega_e = omega_cap;
    s[st::drive_force] = f_drive;

    // 6. Resistances, then the brake as friction: it can stop the car, never
    // push it backwards.
    const double grade = clamp(finite_or(u[in::grade], 0.0), -0.5, 0.5);
    const double f_aero = -0.5 * kAirDensity * p[prm::cda] * v * absd(v);
    const double f_roll = -p[prm::crr] * m * kGravity * clamp(v / 0.3, -1.0, 1.0);
    const double f_grade = -m * kGravity * grade / std::sqrt(1.0 + grade * grade);
    const double v_free = v + h * (f_drive + f_aero + f_roll + f_grade) / m_eff;
    const double brake_dv = h * s[st::brake] * p[prm::brake_decel] * m / m_eff;
    double v_new = 0.0;
    if (v_free > brake_dv) {
        v_new = v_free - brake_dv;
    } else if (v_free < -brake_dv) {
        v_new = v_free + brake_dv;
    }
    if (sel == kSelPark && absd(v_new) < 0.3) v_new = 0.0; // the pawl
    s[st::accel] = (v_new - v) / h;
    s[st::speed] = v_new;
    s[st::distance] += v_new * h;
    if (locked) omega_e = v_new * ratio / r;
    s[st::omega_e] = omega_e;
    s[st::time] += h;

    // 7. Body.
    ride(p, s, u, h);
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

int sw_veh_param_count(void) {
    return kParamCount;
}
int sw_veh_state_count(void) {
    return kStateCount;
}
int sw_veh_input_count(void) {
    return kInputCount;
}
int sw_veh_telemetry_count(void) {
    return kTelemetryCount;
}
int sw_veh_variant_count(void) {
    return kVariantCount;
}

void sw_veh_params(int variant, double* out) {
    if (out == nullptr) return;
    const std::span<double, kParamCount> p(out, kParamCount);
    const Variant& v = kVariants[(variant >= 0 && variant < kVariantCount) ? variant : 0];
    for (double& x : p) x = 0.0;
    p[prm::mass] = v.mass;
    p[prm::cda] = v.cda;
    p[prm::crr] = v.crr;
    p[prm::wheel_radius] = v.wheel_radius;
    p[prm::final_drive] = v.final_drive;
    p[prm::gear_count] = static_cast<double>(v.gears);
    for (size_t i = 0; i < kMaxGears; ++i) p[prm::gear_ratio0 + i] = v.ratios[i];
    p[prm::reverse_ratio] = v.reverse_ratio;
    p[prm::engine_inertia] = v.engine_inertia;
    p[prm::idle_rpm] = v.idle_rpm;
    p[prm::redline_rpm] = v.redline_rpm;
    p[prm::torque_rpm_step] = v.torque_rpm_step;
    for (size_t i = 0; i < kTorqueBins; ++i) p[prm::torque0 + i] = v.torque[i];
    p[prm::friction0] = v.friction0;
    p[prm::friction_per_krpm] = v.friction_per_krpm;
    p[prm::throttle_tau] = v.throttle_tau;
    p[prm::brake_tau] = v.brake_tau;
    p[prm::stall_rpm] = v.stall_rpm;
    p[prm::stall_torque_ratio] = v.stall_torque_ratio;
    p[prm::coupling_ratio] = v.coupling_ratio;
    p[prm::lockup_gear] = v.lockup_gear;
    p[prm::lockup_speed] = v.lockup_speed;
    p[prm::up_rpm_light] = v.up_light;
    p[prm::up_rpm_full] = v.up_full;
    p[prm::down_rpm_light] = v.down_light;
    p[prm::down_rpm_full] = v.down_full;
    p[prm::shift_time] = v.shift_time;
    p[prm::shift_interval] = v.shift_interval;
    p[prm::kickdown_pedal] = v.kickdown;
    p[prm::shift_torque_factor] = v.shift_torque_factor;
    p[prm::brake_decel] = v.brake_decel;
    p[prm::driveline_eff] = v.driveline_eff;
    p[prm::pitch_hz] = v.pitch_hz;
    p[prm::pitch_zeta] = v.pitch_zeta;
    p[prm::pitch_gain] = v.pitch_gain;
    p[prm::heave_hz] = v.heave_hz;
    p[prm::heave_zeta] = v.heave_zeta;
    p[prm::roll_hz] = v.roll_hz;
    p[prm::roll_zeta] = v.roll_zeta;
    p[prm::roll_gain] = v.roll_gain;
    p[prm::road_amplitude] = v.road_amplitude;
    p[prm::road_length] = v.road_length;
    p[prm::road_roll_share] = v.road_roll_share;
    p[prm::driver_kp] = v.driver_kp;
    p[prm::driver_ki] = v.driver_ki;
    p[prm::driver_accel] = v.driver_accel;
    p[prm::driver_decel] = v.driver_decel;
    p[prm::driver_accel_ref] = v.driver_accel_ref;
}

void sw_veh_reset(const double* params, double* state, double speed_mps, int selector,
                  unsigned int seed) {
    if (params == nullptr || state == nullptr) return;
    const Params p(params, kParamCount);
    const State s(state, kStateCount);
    for (double& x : s) x = 0.0;
    const int sel = selector_of(static_cast<double>(selector));
    double v = clamp(finite_or(speed_mps, 0.0), 0.0, 90.0);
    if (sel == kSelPark || sel == kSelNeutral) v = 0.0;
    if (sel == kSelReverse) v = -v;
    s[st::speed] = v;
    s[st::selector] = static_cast<double>(sel);
    s[st::rng] = static_cast<double>(seed != 0U ? seed : 0x9E3779B9U);
    s[st::road_next] = next_knot(s);
    s[st::road_roll_next] = next_knot(s);
    s[st::since_shift] = 1e3;
    int g = 0;
    if (sel == kSelReverse) g = -1;
    if (sel == kSelDrive) g = gear_for_speed(p, v);
    s[st::gear] = static_cast<double>(g);
    const double omega_t = v * overall_ratio(p, g) / p[prm::wheel_radius];
    const double idle_w = p[prm::idle_rpm] * kRpmToRadPerSec;
    s[st::omega_t] = omega_t;
    s[st::omega_e] = omega_t > idle_w ? omega_t : idle_w;
    if (v == 0.0) s[st::brake] = 1.0; // standing: the foot is on the brake
    if (sel == kSelDrive && g >= static_cast<int>(p[prm::lockup_gear]) &&
        v >= p[prm::lockup_speed]) {
        s[st::lockup] = 1.0;
        s[st::omega_e] = omega_t;
    }
}

void sw_veh_step(const double* params, double* state, const double* inputs, double dt, int steps) {
    if (params == nullptr || state == nullptr || inputs == nullptr) return;
    if (!(dt > 0.0)) return;
    const double h = dt < (1.0 / 30.0) ? dt : (1.0 / 30.0);
    const int n = steps < kMaxStepsPerCall ? steps : kMaxStepsPerCall;
    const Params p(params, kParamCount);
    const State s(state, kStateCount);
    const Inputs u(inputs, kInputCount);
    for (int i = 0; i < n; ++i) step_once(p, s, u, h);
}

void sw_veh_telemetry(const double* params, const double* state, double* out) {
    if (params == nullptr || state == nullptr || out == nullptr) return;
    const Params p(params, kParamCount);
    const std::span<const double, kStateCount> s(state, kStateCount);
    const std::span<double, kTelemetryCount> t(out, kTelemetryCount);
    const double v = s[st::speed];
    const double rpm_e = s[st::omega_e] * kRadPerSecToRpm;
    const double rpm_t = absd(s[st::omega_t]) * kRadPerSecToRpm;
    t[0] = v;
    t[1] = absd(v) * 3.6;
    t[2] = rpm_e;
    t[3] = s[st::gear];
    t[4] = s[st::selector];
    t[5] = s[st::throttle];
    t[6] = s[st::brake];
    t[7] = s[st::load];
    t[8] = s[st::accel];
    t[9] = s[st::lat_accel];
    t[10] = s[st::pitch];
    t[11] = s[st::heave];
    t[12] = s[st::roll];
    t[13] = s[st::pitch_rate];
    t[14] = s[st::shift_timer] > 0.0 ? 1.0 : 0.0;
    t[15] = s[st::shift_count];
    t[16] = s[st::lockup];
    t[17] = s[st::gear] == 0.0 ? 0.0 : rpm_e - rpm_t;
    t[18] = s[st::engine_torque];
    t[19] = s[st::drive_force];
    t[20] = s[st::distance];
    t[21] = s[st::time];
    t[22] = rpm_t;
    t[23] = p[prm::redline_rpm];
}

} // extern "C"
