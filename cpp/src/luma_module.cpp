/**
 * luma_module.cpp
 * Rec.709 luma chores for the WebGPU StreetView WASM module — the CPU fallback
 * path behind src/renderer/gpuChores.
 *
 * Split out of noise_module.cpp so the numeric layer has one translation unit
 * per domain. The exported ABI is unchanged — these are the same `sw_*`
 * definitions, in their own TU.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview/abi.h"
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

namespace {

int bt709_bin_u8(unsigned char r, unsigned char g, unsigned char b) {
    float acc = 0.2126f * static_cast<float>(r) + 0.7152f * static_cast<float>(g) +
                0.0722f * static_cast<float>(b);
    int bin = static_cast<int>(floorf(acc + 0.5f));
    if (bin < 0) bin = 0;
    if (bin > 255) bin = 255;
    return bin;
}

/** Integer Rec.709 weights (sum 10000): exact luma * 10000 for 8-bit RGB. */
constexpr uint32_t kLumaWr = 2126u;
constexpr uint32_t kLumaWg = 7152u;
constexpr uint32_t kLumaWb = 722u;
/** 255 * 10000: integer luma of white. */
constexpr double kLumaFullScale = 2550000.0;

/**
 * Box average of the source pixels that map onto destination pixel (dx, dy)
 * — the exact (truncating) integer average sw_downsample_2d writes. Shared so
 * the fused sw_luma_analyze bins the same pixels a downsample-then-histogram
 * pipeline would.
 */
void box_average(std::span<const unsigned char> in, int src_w, int src_h, int dst_w, int dst_h,
                 int dx, int dy, int out4[4]) {
    int y0 = (dy * src_h) / dst_h;
    int y1 = ((dy + 1) * src_h) / dst_h;
    if (y1 <= y0) y1 = y0 + 1;
    if (y1 > src_h) y1 = src_h;
    int x0 = (dx * src_w) / dst_w;
    int x1 = ((dx + 1) * src_w) / dst_w;
    if (x1 <= x0) x1 = x0 + 1;
    if (x1 > src_w) x1 = src_w;
    int sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            const size_t base =
                (static_cast<size_t>(y) * static_cast<size_t>(src_w) + static_cast<size_t>(x)) * 4u;
            sr += static_cast<int>(in[base]);
            sg += static_cast<int>(in[base + 1]);
            sb += static_cast<int>(in[base + 2]);
            sa += static_cast<int>(in[base + 3]);
            n += 1;
        }
    }
    if (n <= 0) {
        out4[0] = 0;
        out4[1] = 0;
        out4[2] = 0;
        out4[3] = 255;
    } else {
        out4[0] = sr / n;
        out4[1] = sg / n;
        out4[2] = sb / n;
        out4[3] = sa / n;
    }
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

void sw_luma_histogram_bt709(const unsigned char* rgba, int width, int height, unsigned int* bins) {
    if (bins == nullptr) return;
    const std::span<unsigned int, 256> bin_span(bins, 256);
    for (size_t i = 0; i < 256; ++i) bin_span[i] = 0u;
    if (width <= 0 || height <= 0 || rgba == nullptr) return;
    const int count = width * height;
    const std::span<const unsigned char> px(rgba, static_cast<size_t>(count) * 4u);
    for (int i = 0; i < count; ++i) {
        const size_t base = static_cast<size_t>(i) * 4u;
        int bin = bt709_bin_u8(px[base], px[base + 1], px[base + 2]);
        bin_span[static_cast<size_t>(bin)] += 1u;
    }
}

void sw_reduce_luma_bt709(const unsigned char* rgba, int width, int height, float* out3) {
    if (out3 == nullptr) return;
    const std::span<float, 3> out(out3, 3);
    out[0] = 0.0f;
    out[1] = 0.0f;
    out[2] = 0.0f;
    if (width <= 0 || height <= 0 || rgba == nullptr) return;
    const int count = width * height;
    const std::span<const unsigned char> px(rgba, static_cast<size_t>(count) * 4u);
    // f64 accumulator: an f32 running sum over a 1080p frame drifts by ~1%
    // once the sum dwarfs each addend. The JS twin sums in f64 as well.
    double sum = 0.0;
    float mn = 1.0f;
    float mx = 0.0f;
    for (int i = 0; i < count; ++i) {
        const size_t base = static_cast<size_t>(i) * 4u;
        float y =
            (0.2126f * static_cast<float>(px[base]) + 0.7152f * static_cast<float>(px[base + 1]) +
             0.0722f * static_cast<float>(px[base + 2])) /
            255.0f;
        sum += static_cast<double>(y);
        if (y < mn) mn = y;
        if (y > mx) mx = y;
    }
    out[0] = static_cast<float>(sum / static_cast<double>(count));
    out[1] = mn;
    out[2] = mx;
}

void sw_downsample_2d(const unsigned char* src, int src_w, int src_h, unsigned char* dst, int dst_w,
                      int dst_h) {
    if (src == nullptr || dst == nullptr) return;
    if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return;
    const std::span<const unsigned char> in(src, static_cast<size_t>(src_w) *
                                                     static_cast<size_t>(src_h) * 4u);
    const std::span<unsigned char> out(dst, static_cast<size_t>(dst_w) *
                                                static_cast<size_t>(dst_h) * 4u);
    int px[4];
    for (int dy = 0; dy < dst_h; ++dy) {
        for (int dx = 0; dx < dst_w; ++dx) {
            box_average(in, src_w, src_h, dst_w, dst_h, dx, dy, px);
            const size_t dbase =
                (static_cast<size_t>(dy) * static_cast<size_t>(dst_w) + static_cast<size_t>(dx)) *
                4u;
            out[dbase] = static_cast<unsigned char>(px[0]);
            out[dbase + 1] = static_cast<unsigned char>(px[1]);
            out[dbase + 2] = static_cast<unsigned char>(px[2]);
            out[dbase + 3] = static_cast<unsigned char>(px[3]);
        }
    }
}

void sw_luma_analyze(const unsigned char* rgba, int width, int height, int dst_w, int dst_h,
                     unsigned int* bins, float* stats3) {
    if (bins == nullptr || stats3 == nullptr) return;
    const std::span<unsigned int, 256> bin_span(bins, 256);
    const std::span<float, 3> stats(stats3, 3);
    for (size_t i = 0; i < 256; ++i) bin_span[i] = 0u;
    stats[0] = 0.0f;
    stats[1] = 0.0f;
    stats[2] = 0.0f;
    if (rgba == nullptr || width <= 0 || height <= 0 || dst_w <= 0 || dst_h <= 0) return;
    const std::span<const unsigned char> in(rgba, static_cast<size_t>(width) *
                                                      static_cast<size_t>(height) * 4u);

    // One pass over the destination grid: box-average (identical to
    // sw_downsample_2d), bin (identical to sw_luma_histogram_bt709), and an
    // integer luma sum. 2126/7152/722 are the Rec.709 weights scaled to sum
    // to 10000, so every pixel's luma is an exact integer and a uint64 sum
    // of a whole frame is exact — the mean has one rounding, at the end.
    uint64_t sum = 0;
    uint32_t mn = 0xFFFFFFFFu;
    uint32_t mx = 0;
    int px[4];
    for (int dy = 0; dy < dst_h; ++dy) {
        for (int dx = 0; dx < dst_w; ++dx) {
            box_average(in, width, height, dst_w, dst_h, dx, dy, px);
            const auto r = static_cast<unsigned char>(px[0]);
            const auto g = static_cast<unsigned char>(px[1]);
            const auto b = static_cast<unsigned char>(px[2]);
            bin_span[static_cast<size_t>(bt709_bin_u8(r, g, b))] += 1u;
            const uint32_t y = kLumaWr * r + kLumaWg * g + kLumaWb * b;
            sum += y;
            if (y < mn) mn = y;
            if (y > mx) mx = y;
        }
    }
    const double count = static_cast<double>(dst_w) * static_cast<double>(dst_h);
    stats[0] = static_cast<float>(static_cast<double>(sum) / (count * kLumaFullScale));
    stats[1] = static_cast<float>(static_cast<double>(mn) / kLumaFullScale);
    stats[2] = static_cast<float>(static_cast<double>(mx) / kLumaFullScale);
}

} // extern "C"
