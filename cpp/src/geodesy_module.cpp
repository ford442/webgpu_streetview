/**
 * geodesy_module.cpp
 * WGS-84 geodesy and angle helpers for the WebGPU StreetView WASM module.
 *
 * Split out of noise_module.cpp so the numeric layer has one translation unit
 * per domain (noise/particles, geodesy, audio, luma). The exported ABI is
 * unchanged — these are the same `sw_*` definitions, in their own TU — plus
 * the route-geometry kernels (initial_bearing, polyline_resample,
 * polyline_project) the routed road trip follows.
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
#include <limits>
#include <span>

namespace {

/** Spherical Earth radius in metres — the value every caller has always used. */
constexpr double kEarthRadiusMeters = 6371000.0;
constexpr double kPi = 3.14159265358979323846;
constexpr double kDegToRad = kPi / 180.0;
constexpr double kRadToDeg = 180.0 / kPi;

/** Wrap a longitude into [-180, 180). The JS twin uses the same expression. */
double wrap_longitude(double lng) {
    return lng - 360.0 * floor((lng + 180.0) / 360.0);
}

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

double sw_initial_bearing(double lat1, double lng1, double lat2, double lng2) {
    const double phi1 = lat1 * kDegToRad;
    const double phi2 = lat2 * kDegToRad;
    const double dlng = (lng2 - lng1) * kDegToRad;
    const double y = sin(dlng) * cos(phi2);
    const double x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlng);
    return fmod(atan2(y, x) * kRadToDeg + 360.0, 360.0);
}

int sw_polyline_resample(const double* in, int n, double step_m,
                         double* out, int cap) {
    if (in == nullptr || n <= 0) return 0;
    const std::span<const double> pts(in, static_cast<size_t>(n) * 2);
    const size_t cap_points = (out == nullptr || cap <= 0) ? 0 : static_cast<size_t>(cap);
    const std::span<double> dst(out, cap_points * 2);

    size_t written = 0;
    auto emit = [&](double lat, double lng) {
        if (written < cap_points) {
            dst[written * 2] = lat;
            dst[written * 2 + 1] = wrap_longitude(lng);
        }
        ++written;
    };

    // A step that cannot advance (<= 0, NaN, inf) is a copy-through: the caller
    // asked for no resampling rather than for an unbounded loop.
    if (!(step_m > 0.0) || !std::isfinite(step_m)) {
        for (size_t i = 0; i < static_cast<size_t>(n); ++i) {
            emit(pts[i * 2], pts[i * 2 + 1]);
        }
        return static_cast<int>(written);
    }

    emit(pts[0], pts[1]);
    // Distance still to travel (along the route) before the next sample.
    double remaining = step_m;
    // Samples within this much of a vertex are dropped in favour of the vertex
    // itself, so a route whose length is an exact multiple of the step does not
    // end on two copies of its last point.
    const double eps = step_m * 1e-9;
    for (size_t i = 0; i + 1 < static_cast<size_t>(n); ++i) {
        const double lat1 = pts[i * 2];
        const double lng1 = pts[i * 2 + 1];
        const double lat2 = pts[i * 2 + 2];
        const double lng2 = pts[i * 2 + 3];
        const double seg = sw_haversine(lat1, lng1, lat2, lng2);
        if (!(seg > 0.0)) continue;
        const double bearing = sw_initial_bearing(lat1, lng1, lat2, lng2);
        double t = remaining;
        while (t < seg - eps) {
            double p[2] = { 0.0, 0.0 };
            sw_offset_latlng(lat1, lng1, t, bearing, p);
            emit(p[0], p[1]);
            t += step_m;
        }
        remaining = t - seg;
    }
    const size_t last = (static_cast<size_t>(n) - 1) * 2;
    if (n > 1) emit(pts[last], pts[last + 1]);
    return static_cast<int>(written);
}

void sw_polyline_project(const double* poly, int n, double lat, double lng,
                         double* out3) {
    if (out3 == nullptr) return;
    const std::span<double, 3> out(out3, 3);
    out[0] = -1.0;
    out[1] = 0.0;
    out[2] = 0.0;
    if (poly == nullptr || n <= 0) return;
    const std::span<const double> pts(poly, static_cast<size_t>(n) * 2);

    if (n == 1) {
        out[0] = 0.0;
        out[2] = sw_haversine(pts[0], pts[1], lat, lng);
        return;
    }

    double best_dist = std::numeric_limits<double>::infinity();
    double best_along = 0.0;
    double best_cross = 0.0;
    int best_seg = 0;
    double cumulative = 0.0;
    for (size_t i = 0; i + 1 < static_cast<size_t>(n); ++i) {
        const double lat1 = pts[i * 2];
        const double lng1 = pts[i * 2 + 1];
        const double lat2 = pts[i * 2 + 2];
        const double lng2 = pts[i * 2 + 3];
        const double seg = sw_haversine(lat1, lng1, lat2, lng2);
        const double d13 = sw_haversine(lat1, lng1, lat, lng);

        double along = 0.0;   // metres from this segment's start, clamped to [0, seg]
        double cross = 0.0;   // signed: + is right of the direction of travel
        double dist = d13;    // unsigned distance to the closest point on the segment
        if (seg > 0.0 && d13 > 0.0) {
            const double delta13 = d13 / kEarthRadiusMeters;
            const double dtheta =
                (sw_initial_bearing(lat1, lng1, lat, lng)
                 - sw_initial_bearing(lat1, lng1, lat2, lng2)) * kDegToRad;
            const double xt = asin(sin(delta13) * sin(dtheta));
            // Right spherical triangle: tan(at) = tan(d13) * cos(dtheta). The
            // atan2 form is signed and stays well conditioned at street scale,
            // where acos(cos d13 / cos xt) loses half its digits.
            const double at =
                atan2(sin(delta13) * cos(dtheta), cos(delta13)) * kEarthRadiusMeters;
            const double sign = xt < 0.0 ? -1.0 : 1.0;
            if (at <= 0.0) {
                along = 0.0;
                dist = d13;
            } else if (at >= seg) {
                along = seg;
                dist = sw_haversine(lat2, lng2, lat, lng);
            } else {
                along = at;
                dist = fabs(xt) * kEarthRadiusMeters;
            }
            cross = sign * dist;
        }
        // Strict < : on a tie the earlier segment wins, on every backend.
        if (dist < best_dist) {
            best_dist = dist;
            best_seg = static_cast<int>(i);
            best_along = cumulative + along;
            best_cross = cross;
        }
        cumulative += seg;
    }
    out[0] = static_cast<double>(best_seg);
    out[1] = best_along;
    out[2] = best_cross;
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
