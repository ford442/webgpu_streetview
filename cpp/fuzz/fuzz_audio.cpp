/**
 * cpp/fuzz/fuzz_audio.cpp — fill_hrtf, fill_cabin_ir and fill_engine_noise on
 * raw float parameters (NaN azimuth, inf / enormous / negative sample rates,
 * any vehicle id, negative or huge counts clamped to a fuzzable size).
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <cmath>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    const int count = in.range(-2, 4096);
    const size_t n = count > 0 ? static_cast<size_t>(count) : 0;
    const float azimuth = in.take<float>();
    const float sample_rate = in.take<float>();
    const int vehicle = in.take<int>();
    const float openness = in.take<float>();

    std::vector<float> left(n), right(n), ir(n), noise(n);
    sw_fill_hrtf(n ? left.data() : nullptr, n ? right.data() : nullptr, count, azimuth,
                 sample_rate);
    sw_fill_cabin_ir(n ? ir.data() : nullptr, count, vehicle, openness, sample_rate);
    const double phase =
        sw_fill_engine_noise(n ? noise.data() : nullptr, count, in.take<float>(), in.take<float>(),
                             in.take<float>(), in.take<double>(), in.take<double>(), sample_rate);
    // The documented phase range, whatever the inputs were.
    sv_fuzz::require(phase >= 0.0 && phase < 1.0);
    // Outputs are finite: NaN / inf parameters are sanitised, never propagated.
    for (size_t i = 0; i < n; ++i) {
        sv_fuzz::require(std::isfinite(left[i]) && std::isfinite(right[i]));
        sv_fuzz::require(std::isfinite(ir[i]) && std::isfinite(noise[i]));
    }
    return 0;
}
