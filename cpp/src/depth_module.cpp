/**
 * depth_module.cpp
 * Scene-depth calibration for the WebGPU StreetView WASM module: the CPU
 * arithmetic between the depth network's output and the `r16float` depth
 * texture (src/renderer/depth/DepthController.ts, docs/SCENE_DEPTH.md).
 *
 * Depth Anything predicts affine-invariant disparity (unknown scale and
 * shift), so each map is stretched to "nearness" n in [0, 1] between its 2nd
 * and 98th percentiles, turned into depth = q / n on the `viewDepthProxy`
 * scale (0 = at the camera, 1 = horizon or beyond), with q calibrated against
 * the proxy on the ground in front of the camera, and eased across inferences
 * of the same scene.
 *
 * Arithmetic is f64 throughout with f32 storage — the maps are Float32Arrays
 * on the TS side — and contains no transcendentals, so the binary, the host
 * build and the goldens agree to the last bit. Nothing here allocates or
 * sorts: the percentiles and the ground median are exact radix selects
 * (select_kth) over values recomputed per pass, in O(n).
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview/abi.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <span>

namespace {

/** Percentiles are read from at most this many texels (a fixed stride). */
constexpr int kPercentileSamples = 16384;
/** viewDepthProxy's hyperbola: 0.06 / (y - horizon) below the horizon. */
constexpr double kProxyGroundK = 0.06;
/** Depth of the nearest disparity when the ground cannot calibrate it. */
constexpr double kDefaultNearDepth = 0.1;
/** A car or wall filling the bottom must not run the calibration away. */
constexpr double kNearDepthMin = 0.04;
constexpr double kNearDepthMax = 0.3;
constexpr double kLowPercentile = 0.02;
constexpr double kHighPercentile = 0.98;
/** Weight of the newest inference in the EMA (range, scale and texels). */
constexpr double kEmaAlpha = 0.5;

struct Range {
    double lo;
    double hi;
};

/**
 * Order-preserving unsigned key of a float/double: flip every bit of a
 * negative, set the sign bit of a non-negative. Unsigned key order is the
 * numeric order of the (finite) values, with -0 just below +0.
 */
template <typename F, typename U> [[nodiscard]] U order_key(F v) {
    static_assert(sizeof(F) == sizeof(U));
    U bits = 0;
    std::memcpy(&bits, &v, sizeof bits);
    constexpr U sign = U{1} << (sizeof(U) * 8 - 1);
    return (bits & sign) != 0 ? static_cast<U>(~bits) : static_cast<U>(bits | sign);
}

template <typename F, typename U> [[nodiscard]] F from_order_key(U key) {
    constexpr U sign = U{1} << (sizeof(U) * 8 - 1);
    const U bits = (key & sign) != 0 ? static_cast<U>(key & ~sign) : static_cast<U>(~key);
    F v = 0;
    std::memcpy(&v, &bits, sizeof v);
    return v;
}

/**
 * The k-th smallest (0-based) of the values `visit` produces, exactly: a
 * most-significant-digit radix select, one 256-bin counting pass per key
 * byte, each pass counting only the values that share the digits fixed so
 * far. O(n * sizeof(F)), a 1 KiB histogram on the stack, nothing allocated,
 * nothing sorted — `visit(fn)` must call fn with the same values, in any
 * order, every time (the callers recompute them instead of storing them).
 */
template <typename F, typename U, typename Visit>
[[nodiscard]] F select_kth(size_t k, const Visit& visit) {
    U prefix = 0;
    U mask = 0;
    for (int shift = static_cast<int>(sizeof(U) * 8) - 8; shift >= 0; shift -= 8) {
        std::array<uint32_t, 256> hist{};
        visit([&](F v) {
            const U key = order_key<F, U>(v);
            if ((key & mask) == prefix) ++hist[static_cast<size_t>((key >> shift) & 0xFFU)];
        });
        size_t below = 0;
        size_t digit = 0;
        while (below + hist[digit] <= k) below += hist[digit++];
        k -= below;
        prefix |= static_cast<U>(static_cast<U>(digit) << shift);
        mask |= static_cast<U>(U{0xFF} << shift);
    }
    return from_order_key<F, U>(prefix);
}

/**
 * Exact order statistics of a strided subsample (non-finite texels skipped),
 * by radix select: the same values a sort of the subsample would read.
 */
[[nodiscard]] Range percentiles(std::span<const float> disparity, double low_pct, double high_pct) {
    const size_t stride =
        std::max<size_t>(1, (disparity.size() + kPercentileSamples - 1) / kPercentileSamples);
    const auto visit = [&](const auto& fn) {
        for (size_t i = 0; i < disparity.size(); i += stride) {
            const float v = disparity[i];
            if (std::isfinite(v)) fn(v);
        }
    };
    size_t n = 0;
    visit([&](float) { ++n; });
    if (n == 0) return {0.0, 0.0};
    const double last = static_cast<double>(n - 1);
    const auto at = [&](double pct) {
        const double index = std::min(last, std::max(0.0, std::round(pct * last)));
        return static_cast<double>(select_kth<float, uint32_t>(static_cast<size_t>(index), visit));
    };
    return {at(low_pct), at(high_pct)};
}

/**
 * Proxy-scale depth of the nearest disparity, from the bottom-centre band
 * (rows 85-98 %, columns 30-70 %, every other column) where a Street View
 * frame looks at the road: q = proxy(y) * n there, median over the band,
 * clamped. The default when the horizon is too low for that band to be ground.
 * The band's products are recomputed on each radix pass rather than stored.
 */
[[nodiscard]] double near_depth(std::span<const float> nearness, int width, int height,
                                double horizon_y) {
    const int y0 = static_cast<int>(std::floor(height * 0.85));
    const int y1 = static_cast<int>(std::floor(height * 0.98));
    if (horizon_y > 0.7 || y1 <= y0) return kDefaultNearDepth;
    const int x0 = static_cast<int>(std::floor(width * 0.3));
    const int x1 = static_cast<int>(std::ceil(width * 0.7));
    const auto visit = [&](const auto& fn) {
        for (int y = y0; y < y1; ++y) {
            const double below = (y + 0.5) / height - horizon_y;
            if (below <= 0.0) continue;
            const double proxy = std::min(1.0, kProxyGroundK / std::max(below, 0.0025));
            for (int x = x0; x < x1; x += 2) {
                const double n = static_cast<double>(
                    nearness[static_cast<size_t>(y) * static_cast<size_t>(width) +
                             static_cast<size_t>(x)]);
                if (n > 0.02) fn(proxy * n);
            }
        }
    };
    size_t count = 0;
    visit([&](double) { ++count; });
    if (count < 8) return kDefaultNearDepth;
    const double median = select_kth<double, uint64_t>(count >> 1, visit);
    return std::min(kNearDepthMax, std::max(kNearDepthMin, median));
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

void sw_depth_percentiles(const float* disparity, int count, double low_pct, double high_pct,
                          double* out2) {
    if (!out2) return;
    if (!disparity || count <= 0) {
        out2[0] = 0.0;
        out2[1] = 0.0;
        return;
    }
    const size_t n = static_cast<size_t>(count);
    const Range r = percentiles({disparity, n}, low_pct, high_pct);
    out2[0] = r.lo;
    out2[1] = r.hi;
}

double sw_depth_near_depth(const float* nearness, int width, int height, double horizon_y) {
    if (!nearness || width <= 0 || height <= 0) return kDefaultNearDepth;
    return near_depth({nearness, static_cast<size_t>(width) * static_cast<size_t>(height)}, width,
                      height, horizon_y);
}

void sw_depth_normalize(const float* disparity, int count, int width, int height, double horizon_y,
                        int aligned, int same_scene, double* state3, const float* previous,
                        float* out) {
    if (!disparity || !state3 || !out || count <= 0) return;
    const size_t n = static_cast<size_t>(count);
    const std::span<const float> in{disparity, n};
    const std::span<float> dst{out, n};

    // `out` holds the nearness map until the last loop turns it into depth.
    Range r = percentiles(in, kLowPercentile, kHighPercentile);
    double& lo = state3[0];
    double& hi = state3[1];
    double& q_state = state3[2];
    const bool ease = same_scene != 0 && hi > lo;
    if (ease) {
        r.lo = lo + (r.lo - lo) * kEmaAlpha;
        r.hi = hi + (r.hi - hi) * kEmaAlpha;
    }
    lo = r.lo;
    hi = r.hi;
    const double range = r.hi - r.lo;
    const double inv = range > 1e-6 ? 1.0 / range : 0.0;
    for (size_t i = 0; i < n; ++i) {
        const float d = in[i];
        dst[i] = inv > 0.0 && std::isfinite(d)
                     ? static_cast<float>(
                           std::min(1.0, std::max(0.0, (static_cast<double>(d) - r.lo) * inv)))
                     : 0.0f;
    }

    // A nearness map that is not width x height cannot calibrate; the default does.
    const bool shaped =
        width > 0 && height > 0 && static_cast<size_t>(width) * static_cast<size_t>(height) == n;
    double q = shaped ? near_depth(dst, width, height, horizon_y) : kDefaultNearDepth;
    if (ease && q_state > 0.0) q = q_state + (q - q_state) * kEmaAlpha;
    q_state = q;

    for (size_t i = 0; i < n; ++i) {
        const double near = static_cast<double>(dst[i]);
        const double depth = near > q ? q / near : 1.0;
        if (aligned != 0 && previous) {
            const double prev = static_cast<double>(previous[i]);
            dst[i] = static_cast<float>(prev + (depth - prev) * kEmaAlpha);
        } else {
            dst[i] = static_cast<float>(depth);
        }
    }
}

} // extern "C"
