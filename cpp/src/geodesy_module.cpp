/**
 * geodesy_module.cpp
 * WGS-84 geodesy and angle helpers for the WebGPU StreetView WASM module.
 *
 * Split out of noise_module.cpp so the numeric layer has one translation unit
 * per domain (noise/particles, geodesy, audio, luma). The exported ABI is
 * unchanged — these are the same `sw_*` definitions, in their own TU.
 *
 * Every formula here is the single copy in the app: `src/utils/navigation.ts`
 * and `src/utils/historicalImagery.ts` call into this module (or its
 * bit-compatible twin in `src/wasm/jsFallback.ts`) rather than re-deriving the
 * math in TypeScript.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include <cmath>
#include <cstddef>
#include <span>

namespace {

/** Spherical Earth radius in metres — the value every caller has always used. */
constexpr double kEarthRadiusMeters = 6371000.0;
constexpr double kPi = 3.14159265358979323846;
constexpr double kDegToRad = kPi / 180.0;
constexpr double kRadToDeg = 180.0 / kPi;

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

// Haversine formula, result in metres.
double sw_haversine(double lat1, double lon1, double lat2, double lon2) {
    double dlat = (lat2 - lat1) * kDegToRad;
    double dlon = (lon2 - lon1) * kDegToRad;
    double a = sin(dlat * 0.5) * sin(dlat * 0.5)
             + cos(lat1 * kDegToRad) * cos(lat2 * kDegToRad)
             * sin(dlon * 0.5) * sin(dlon * 0.5);
    return kEarthRadiusMeters * 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
}

double sw_batch_haversine(const double* points, int count, double* out) {
    if (count < 2) return 0.0;
    const std::span<const double> pts(points, static_cast<size_t>(count) * 2);
    const std::span<double> segs(out, static_cast<size_t>(count) - 1);
    double total = 0.0;
    for (int i = 0; i < count - 1; ++i) {
        const size_t base = static_cast<size_t>(i) * 2;
        double d = sw_haversine(pts[base], pts[base + 1],
                                pts[base + 2], pts[base + 3]);
        segs[static_cast<size_t>(i)] = d;
        total += d;
    }
    return total;
}

void sw_offset_latlng(double lat, double lng, double distance_meters,
                      double bearing_deg, double* out2) {
    if (out2 == nullptr) return;
    const std::span<double, 2> out(out2, 2);

    const double bearing = bearing_deg * kDegToRad;
    const double lat_rad = lat * kDegToRad;
    const double lng_rad = lng * kDegToRad;
    const double angular = distance_meters / kEarthRadiusMeters;

    const double sin_lat = sin(lat_rad);
    const double cos_lat = cos(lat_rad);
    const double sin_ang = sin(angular);
    const double cos_ang = cos(angular);

    const double new_lat_rad =
        asin(sin_lat * cos_ang + cos_lat * sin_ang * cos(bearing));
    const double new_lng_rad =
        lng_rad + atan2(sin(bearing) * sin_ang * cos_lat,
                        cos_ang - sin_lat * sin(new_lat_rad));

    out[0] = new_lat_rad * kRadToDeg;
    out[1] = new_lng_rad * kRadToDeg;
}

float sw_normalize_angle(float angle) {
    return fmodf(fmodf(angle, 360.0f) + 360.0f, 360.0f);
}

float sw_signed_angle_diff(float from, float to) {
    float diff = fmodf((to - from + 180.0f), 360.0f) - 180.0f;
    // fmodf keeps the sign of the dividend, so a negative (to - from + 180)
    // lands the result below -180 (e.g. to-from = -183 yields -183 instead of
    // +177). The correction below is what the JS fallback in
    // src/wasm/jsFallback.ts and signedAngleDiff() in src/utils/navigation.ts
    // all do; without it this function silently disagreed with every other
    // implementation for negative differences.
    if (diff < -180.0f) diff += 360.0f;
    // Exactly-opposite inputs still return -180 (not +180), matching the other
    // implementations.
    return diff;
}

} // extern "C"
