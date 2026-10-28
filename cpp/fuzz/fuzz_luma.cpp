/**
 * cpp/fuzz/fuzz_luma.cpp — luma_analyze, downsample_2d, the histogram and the
 * reduce on arbitrary sizes (zero, negative, upsampling, 1-pixel) and pixels.
 * Every buffer is exactly the size abi.h documents, so ASan sees any overrun.
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <array>
#include <cmath>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    const int w = in.range(-2, 64);
    const int h = in.range(-2, 64);
    const int dw = in.range(-2, 80);
    const int dh = in.range(-2, 80);
    const size_t src_px = w > 0 && h > 0 ? static_cast<size_t>(w) * static_cast<size_t>(h) : 0;
    const size_t dst_px = dw > 0 && dh > 0 ? static_cast<size_t>(dw) * static_cast<size_t>(dh) : 0;
    std::vector<unsigned char> rgba = in.many<unsigned char>(src_px * 4);

    std::array<unsigned int, 256> bins{};
    std::array<float, 3> stats{};
    sw_luma_analyze(rgba.data(), w, h, dw, dh, bins.data(), stats.data());
    for (const float s : stats) sv_fuzz::require(std::isfinite(s) && s >= 0.0f && s <= 1.0f);
    unsigned long long total = 0;
    for (const unsigned int b : bins) total += b;
    sv_fuzz::require(total <= dst_px);

    std::vector<unsigned char> dst(dst_px * 4);
    sw_downsample_2d(rgba.data(), w, h, dst.data(), dw, dh);

    std::array<unsigned int, 256> hist{};
    sw_luma_histogram_bt709(rgba.data(), w, h, hist.data());
    std::array<float, 3> reduce{};
    sw_reduce_luma_bt709(rgba.data(), w, h, reduce.data());
    for (const float s : reduce) sv_fuzz::require(std::isfinite(s) && s >= 0.0f && s <= 1.0f);
    return 0;
}
