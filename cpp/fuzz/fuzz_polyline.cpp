/**
 * cpp/fuzz/fuzz_polyline.cpp — polyline_project on arbitrary vertex counts and
 * raw f64 coordinates (NaN, inf, poles, antimeridian).
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <array>
#include <cmath>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    const int n = in.range(-1, 48);
    const double lat = in.take<double>();
    const double lng = in.take<double>();
    std::vector<double> poly = in.many<double>(n > 0 ? static_cast<size_t>(n) * 2 : 0);
    std::array<double, 3> out{};
    sw_polyline_project(n > 0 ? poly.data() : nullptr, n, lat, lng, out.data());
    // The segment index is always a vertex of the polyline (or -1 for none).
    sv_fuzz::require(out[0] >= -1.0 && out[0] <= static_cast<double>(n > 0 ? n - 1 : 0));
    return 0;
}
