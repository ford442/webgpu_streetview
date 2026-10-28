/**
 * cpp/fuzz/fuzz_dsp.cpp — the cabin engine as the worklet drives it: an
 * arbitrary interleaving of dsp_set_ir (any length, including over
 * kMaxIrTaps, and non-finite taps), dsp_set_params (raw floats) and
 * dsp_render (any frame count, chunked across partition boundaries). The
 * output is clamped, so every sample must be finite and within [-1, 1].
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <cmath>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    static const float kRates[] = {8000.0f, 22050.0f, 44100.0f, 48000.0f, 96000.0f};
    sw_dsp* dsp = sw_dsp_create(kRates[in.range(0, 4)]);
    if (!dsp) return 0;
    std::vector<float> l(512);
    std::vector<float> r(512);
    std::vector<float> radio_l(512, 0.25f);
    std::vector<float> radio_r(512, -0.25f);
    for (int step = 0; step < 24 && !in.empty(); ++step) {
        switch (in.range(0, 2)) {
        case 0: {
            const int count = in.range(-1, 20000);
            // Mostly a smooth IR (bytes are few); raw floats at the head.
            std::vector<float> taps = in.many<float>(count > 0 ? static_cast<size_t>(count) : 0);
            sw_dsp_set_ir(dsp, count > 0 ? taps.data() : nullptr, count);
            break;
        }
        case 1:
            sw_dsp_set_params(dsp, in.take<float>(), in.take<float>(), in.take<float>(),
                              in.take<float>(), in.range(-3, 8), in.take<float>(), in.take<float>(),
                              in.take<float>(), in.take<float>(), in.range(0, 1));
            break;
        default: {
            const int frames = in.range(0, 512);
            const bool radio = in.range(0, 1) == 1;
            sw_dsp_render(dsp, radio ? radio_l.data() : nullptr, radio ? radio_r.data() : nullptr,
                          l.data(), r.data(), frames);
            for (int i = 0; i < frames; ++i) {
                const auto k = static_cast<size_t>(i);
                sv_fuzz::require(std::isfinite(l[k]) && std::fabs(l[k]) <= 1.0f);
                sv_fuzz::require(std::isfinite(r[k]) && std::fabs(r[k]) <= 1.0f);
            }
            break;
        }
        }
    }
    sw_dsp_destroy(dsp);
    return 0;
}
