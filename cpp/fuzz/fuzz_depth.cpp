/**
 * cpp/fuzz/fuzz_depth.cpp — depth_percentiles, depth_near_depth and
 * depth_normalize on arbitrary maps (NaN/inf texels, shapes that do not match
 * the count, a horizon anywhere) and arbitrary carried EMA state.
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <array>
#include <cmath>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    const int width = in.range(-1, 64);
    const int height = in.range(-1, 64);
    const int count = in.range(-1, 64 * 64);
    const double horizon = in.take<double>();
    const double low = in.take<double>();
    const double high = in.take<double>();
    const int aligned = in.range(0, 1);
    const int same_scene = in.range(0, 1);
    std::array<double, 3> state{in.take<double>(), in.take<double>(), in.take<double>()};
    const size_t n = count > 0 ? static_cast<size_t>(count) : 0;
    std::vector<float> map = in.many<float>(n);
    std::vector<float> previous = in.many<float>(n);

    std::array<double, 2> range{};
    sw_depth_percentiles(map.data(), count, low, high, range.data());

    const size_t shaped =
        width > 0 && height > 0 ? static_cast<size_t>(width) * static_cast<size_t>(height) : 0;
    if (shaped <= n) {
        const double q = sw_depth_near_depth(map.data(), width, height, horizon);
        sv_fuzz::require(std::isfinite(q));
    }

    std::vector<float> out(n);
    sw_depth_normalize(map.data(), count, width, height, horizon, aligned, same_scene, state.data(),
                       aligned != 0 ? previous.data() : nullptr, out.data());
    return 0;
}
