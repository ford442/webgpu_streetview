/**
 * cpp/fuzz/fuzz_noise.cpp — noise2d / fbm2d and the tile fills on raw floats
 * (NaN, inf, coordinates far outside int range) and arbitrary tile shapes.
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <cmath>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    sw_seed(in.take<unsigned int>());
    const float x = in.take<float>();
    const float y = in.take<float>();
    const float v = sw_noise2d(x, y);
    // Finite input stays inside the documented [-1, 1].
    if (std::isfinite(x) && std::isfinite(y)) sv_fuzz::require(std::fabs(v) <= 1.0f);
    (void)sw_fbm2d(x, y, in.range(-1, 12), in.take<float>(), in.take<float>());

    const int w = in.range(-1, 40);
    const int h = in.range(-1, 40);
    const size_t cells = (w > 0 && h > 0) ? static_cast<size_t>(w) * static_cast<size_t>(h) : 0;
    std::vector<float> tile(cells);
    sw_fill_noise_buffer(cells ? tile.data() : nullptr, w, h, in.take<float>(), in.take<float>(),
                         in.take<float>());
    sw_fill_fbm_buffer(cells ? tile.data() : nullptr, w, h, in.take<float>(), in.take<float>(),
                       in.take<float>(), in.range(-1, 8), in.take<float>(), in.take<float>());
    const int seeds = in.range(-1, 256);
    std::vector<float> particles(seeds > 0 ? static_cast<size_t>(seeds) * 4U : 0U);
    sw_fill_particle_seeds(particles.empty() ? nullptr : particles.data(), seeds,
                           in.take<unsigned int>());
    return 0;
}
