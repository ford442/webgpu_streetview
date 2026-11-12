/**
 * atmosphere_module.cpp
 * The physically based atmosphere's CPU reference (Hillaire, "A Scalable and
 * Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020).
 *
 * The GPU builds its look-up tables in public/shaders/atmosphere.wgsl
 * (src/renderer/atmosphere/). This translation unit owns what the CPU needs:
 *
 *   sw_atmo_params           the physical constants, once: Rayleigh, Mie (from
 *                            the live visibility, Koschmieder), ozone, ground
 *                            albedo. The renderer uploads this block verbatim,
 *                            so the GPU and this reference integrate the same
 *                            medium.
 *   sw_atmo_transmittance    optical depth to the top of the atmosphere along
 *                            one ray, the integral the transmittance LUT holds.
 *   sw_atmo_transmittance_lut the whole LUT in the GPU's parameterisation —
 *                            what the SwiftShader parity spec reads back against.
 *   sw_atmo_sun_color        the sun's transmitted colour at an elevation (for
 *                            the cabin lights; white sun, linear RGB).
 *
 * Determinism: the goldens are bit-exact on every build (emcc SIMD and scalar,
 * g++, clang, x86-64-v3). libm's exp differs between musl (emcc) and glibc, so
 * the integral uses det_exp below — Cody-Waite reduction and a Horner
 * polynomial on IEEE add/sub/mul/div — plus sqrt and floor, which are
 * correctly rounded everywhere. No trigonometry: callers pass sines/cosines.
 * Lengths are kilometres, as in Hillaire's reference.
 */

#include "streetview/abi.h"

#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

namespace {

/** Floats in the sw_atmo_params block (see abi.h for the layout). */
constexpr int kParamCount = 24;
/** Midpoint-rule steps of the transmittance integral (the WGSL uses the same). */
constexpr int kTransmittanceSteps = 40;

constexpr double kBottomRadiusKm = 6360.0;
constexpr double kTopRadiusKm = 6460.0;
constexpr double kRayleighScaleHeightKm = 8.0;
constexpr double kMieScaleHeightKm = 1.2;
constexpr double kRayleighScattering[3] = {5.802e-3, 13.558e-3, 33.1e-3};
constexpr double kMieG = 0.8;
/** Mie single-scattering albedo: Hillaire's 3.996e-3 / 4.440e-3. */
constexpr double kMieAlbedo = 0.9;
/** Mie extinction floor (/km): the visibility formula goes to 0 near 290 km. */
constexpr double kMieExtinctionFloor = 1e-4;
constexpr double kOzoneAbsorption[3] = {0.650e-3, 1.881e-3, 0.085e-3};
constexpr double kOzoneCenterKm = 25.0;
constexpr double kOzoneHalfWidthKm = 15.0;
/** Koschmieder: meteorological visibility V = ln(1/0.02) / extinction(550 nm). */
constexpr double kKoschmieder = 3.912;
/** MODTRAN's "rural, 23 km" standard atmosphere when no visibility is known. */
constexpr double kDefaultVisibilityKm = 23.0;
constexpr double kMinVisibilityKm = 0.05;
constexpr double kMaxVisibilityKm = 300.0;
/** sin of the sun's angular radius (0.2667 deg): the disk sets over 2x this in mu. */
constexpr double kSinSunRadius = 0.004654;

constexpr double kLog2e = 1.4426950408889634;
/** ln 2 split so k * kLn2Hi is exact for |k| < 2^11 (Cody-Waite). */
constexpr double kLn2Hi = 6.93147180369123816490e-01;
constexpr double kLn2Lo = 1.90821492927058770002e-10;

/**
 * e^x on IEEE double add/sub/mul/div only, so every build rounds it the same
 * way. |error| < 2 ulp over the range the atmosphere uses; 0 below e^-700.
 */
double det_exp(double x) {
    if (!(x > -700.0)) return 0.0; // also NaN -> 0
    if (x > 700.0) x = 700.0;
    const double k = std::floor(x * kLog2e + 0.5);
    const double r = (x - k * kLn2Hi) - k * kLn2Lo; // |r| <= ~0.347
    // Taylor to degree 13, Horner: the remainder is < 1e-17 relative at |r| = 0.347.
    double p = 1.0 / 6227020800.0;
    p = p * r + 1.0 / 479001600.0;
    p = p * r + 1.0 / 39916800.0;
    p = p * r + 1.0 / 3628800.0;
    p = p * r + 1.0 / 362880.0;
    p = p * r + 1.0 / 40320.0;
    p = p * r + 1.0 / 5040.0;
    p = p * r + 1.0 / 720.0;
    p = p * r + 1.0 / 120.0;
    p = p * r + 1.0 / 24.0;
    p = p * r + 1.0 / 6.0;
    p = p * r + 0.5;
    p = p * r + 1.0;
    p = p * r + 1.0;
    // 2^k by its bit pattern: k is in [-1010, 1010], so the exponent is normal.
    const auto biased = static_cast<uint64_t>(static_cast<int64_t>(k) + 1023);
    return p * std::bit_cast<double>(biased << 52U);
}

double clamp01(double v) {
    if (!(v > 0.0)) return 0.0;
    return v < 1.0 ? v : 1.0;
}

/** The medium, in double, from a sw_atmo_params block. */
struct Medium {
    double bottom = 0.0;
    double top = 0.0;
    double rayleigh_h = 0.0;
    double mie_h = 0.0;
    double rayleigh[3] = {0.0, 0.0, 0.0};
    double mie_ext[3] = {0.0, 0.0, 0.0};
    double ozone[3] = {0.0, 0.0, 0.0};
    double ozone_center = 0.0;
    double ozone_half_width = 1.0;
};

Medium medium_from(std::span<const float, kParamCount> p) {
    Medium m;
    m.bottom = static_cast<double>(p[0]);
    m.top = static_cast<double>(p[1]);
    m.rayleigh_h = static_cast<double>(p[2]);
    m.mie_h = static_cast<double>(p[3]);
    for (size_t c = 0; c < 3; ++c) {
        m.rayleigh[c] = static_cast<double>(p[4 + c]);
        m.mie_ext[c] = static_cast<double>(p[12 + c]);
        m.ozone[c] = static_cast<double>(p[16 + c]);
    }
    m.ozone_center = static_cast<double>(p[11]);
    m.ozone_half_width = static_cast<double>(p[15]);
    if (!(m.ozone_half_width > 0.0)) m.ozone_half_width = 1.0;
    if (!(m.rayleigh_h > 0.0)) m.rayleigh_h = kRayleighScaleHeightKm;
    if (!(m.mie_h > 0.0)) m.mie_h = kMieScaleHeightKm;
    return m;
}

/** Distance from radius r along mu to the top boundary (Bruneton 2017). */
double distance_to_top(const Medium& m, double r, double mu) {
    const double disc = r * r * (mu * mu - 1.0) + m.top * m.top;
    return -r * mu + std::sqrt(disc > 0.0 ? disc : 0.0);
}

/** exp(-optical depth) per channel from (r, mu) to the top of the atmosphere. */
void transmittance(const Medium& m, double r, double mu, double out[3]) {
    const double d = distance_to_top(m, r, mu);
    const double dt = d / static_cast<double>(kTransmittanceSteps);
    double depth[3] = {0.0, 0.0, 0.0};
    for (int i = 0; i < kTransmittanceSteps; ++i) {
        const double t = (static_cast<double>(i) + 0.5) * dt;
        const double ri2 = t * t + 2.0 * r * mu * t + r * r;
        const double h = std::sqrt(ri2 > 0.0 ? ri2 : 0.0) - m.bottom;
        const double rho_r = det_exp(-h / m.rayleigh_h);
        const double rho_m = det_exp(-h / m.mie_h);
        double rho_o = 1.0 - std::fabs(h - m.ozone_center) / m.ozone_half_width;
        if (rho_o < 0.0) rho_o = 0.0;
        for (size_t c = 0; c < 3; ++c) {
            depth[c] += (m.rayleigh[c] * rho_r + m.mie_ext[c] * rho_m + m.ozone[c] * rho_o) * dt;
        }
    }
    for (size_t c = 0; c < 3; ++c) out[c] = det_exp(-depth[c]);
}

/** Observer radius for an altitude in metres, clamped inside the atmosphere. */
double observer_radius(const Medium& m, double altitude_m) {
    double r = m.bottom + (altitude_m > 0.0 ? altitude_m * 1e-3 : 0.0);
    if (r > m.top) r = m.top;
    return r;
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

int sw_atmo_param_count(void) {
    return kParamCount;
}

void sw_atmo_params(double visibility_m, double ground_albedo, float* out) {
    if (out == nullptr) return;
    const std::span<float, kParamCount> p(out, kParamCount);
    double vis_km = visibility_m > 0.0 ? visibility_m * 1e-3 : kDefaultVisibilityKm;
    if (!(vis_km < kMaxVisibilityKm)) vis_km = kMaxVisibilityKm; // also NaN
    if (vis_km < kMinVisibilityKm) vis_km = kMinVisibilityKm;
    // Ground-level extinction at 550 nm (the green channel) minus the air's
    // own: the rest is aerosol. Ozone's tent is zero at the ground.
    double mie_ext = kKoschmieder / vis_km - kRayleighScattering[1];
    if (mie_ext < kMieExtinctionFloor) mie_ext = kMieExtinctionFloor;
    const double albedo = clamp01(ground_albedo);
    const double turbidity = (kRayleighScattering[1] + mie_ext) / kRayleighScattering[1];

    p[0] = static_cast<float>(kBottomRadiusKm);
    p[1] = static_cast<float>(kTopRadiusKm);
    p[2] = static_cast<float>(kRayleighScaleHeightKm);
    p[3] = static_cast<float>(kMieScaleHeightKm);
    for (size_t c = 0; c < 3; ++c) {
        p[4 + c] = static_cast<float>(kRayleighScattering[c]);
        p[8 + c] = static_cast<float>(mie_ext * kMieAlbedo);
        p[12 + c] = static_cast<float>(mie_ext);
        p[16 + c] = static_cast<float>(kOzoneAbsorption[c]);
        p[20 + c] = static_cast<float>(albedo);
    }
    p[7] = static_cast<float>(kMieG);
    p[11] = static_cast<float>(kOzoneCenterKm);
    p[15] = static_cast<float>(kOzoneHalfWidthKm);
    p[19] = static_cast<float>(vis_km);
    p[23] = static_cast<float>(turbidity);
}

void sw_atmo_transmittance(const float* params, double altitude_m, double cos_zenith,
                           float* out_rgb) {
    if (params == nullptr || out_rgb == nullptr) return;
    const Medium m = medium_from(std::span<const float, kParamCount>(params, kParamCount));
    double mu = cos_zenith;
    if (!(mu > -1.0)) mu = -1.0;
    if (mu > 1.0) mu = 1.0;
    double t[3];
    transmittance(m, observer_radius(m, altitude_m), mu, t);
    const std::span<float, 3> out(out_rgb, 3);
    for (size_t c = 0; c < 3; ++c) out[c] = static_cast<float>(t[c]);
}

void sw_atmo_transmittance_lut(const float* params, int width, int height, float* out_rgba) {
    if (params == nullptr || out_rgba == nullptr || width <= 0 || height <= 0) return;
    const Medium m = medium_from(std::span<const float, kParamCount>(params, kParamCount));
    const std::span<float> out(out_rgba,
                               static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
    // Texel (i, j) holds x_mu = i / (w - 1), x_r = j / (h - 1): the sub-UV
    // remap puts the domain's ends on texel centres (Bruneton's
    // GetTextureCoordFromUnitRange).
    const double big_h = std::sqrt(m.top * m.top - m.bottom * m.bottom);
    const double wd = width > 1 ? static_cast<double>(width - 1) : 1.0;
    const double hd = height > 1 ? static_cast<double>(height - 1) : 1.0;
    for (int j = 0; j < height; ++j) {
        const double x_r = static_cast<double>(j) / hd;
        const double rho = big_h * x_r;
        const double r = std::sqrt(rho * rho + m.bottom * m.bottom);
        const double d_min = m.top - r;
        const double d_max = rho + big_h;
        for (int i = 0; i < width; ++i) {
            const double x_mu = static_cast<double>(i) / wd;
            const double d = d_min + x_mu * (d_max - d_min);
            double mu = d == 0.0 ? 1.0 : (big_h * big_h - rho * rho - d * d) / (2.0 * r * d);
            if (mu < -1.0) mu = -1.0;
            if (mu > 1.0) mu = 1.0;
            double t[3];
            transmittance(m, r, mu, t);
            const size_t base =
                (static_cast<size_t>(j) * static_cast<size_t>(width) + static_cast<size_t>(i)) * 4u;
            out[base] = static_cast<float>(t[0]);
            out[base + 1] = static_cast<float>(t[1]);
            out[base + 2] = static_cast<float>(t[2]);
            out[base + 3] = 1.0f;
        }
    }
}

void sw_atmo_sun_color(const float* params, double sin_elevation, double altitude_m,
                       float* out_rgb) {
    if (params == nullptr || out_rgb == nullptr) return;
    const Medium m = medium_from(std::span<const float, kParamCount>(params, kParamCount));
    const std::span<float, 3> out(out_rgb, 3);
    const double r = observer_radius(m, altitude_m);
    double mu = sin_elevation;
    if (!(mu > -1.0)) mu = -1.0;
    if (mu > 1.0) mu = 1.0;
    // The geometric horizon from r: rays below mu_h hit the ground. The disk
    // fades out linearly across its own diameter around it.
    const double q = m.bottom / r;
    const double mu_h = -std::sqrt(1.0 - q * q);
    const double visible = clamp01((mu - mu_h) / (2.0 * kSinSunRadius) + 0.5);
    double t[3] = {0.0, 0.0, 0.0};
    if (visible > 0.0) {
        transmittance(m, r, mu > mu_h ? mu : mu_h, t);
    }
    for (size_t c = 0; c < 3; ++c) out[c] = static_cast<float>(t[c] * visible);
}

} // extern "C"
