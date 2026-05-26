/**
 * bindings.cpp
 * Emscripten JavaScript bindings for the WebGPU StreetView WASM module.
 *
 * This file is compiled only when targeting Emscripten. It uses either:
 *   - EMSCRIPTEN_BINDINGS (embind) for a higher-level OO-style interface, OR
 *   - cwrap/ccall-compatible plain C exports (simpler, lighter weight).
 *
 * The C exports in noise_module.cpp are exported directly via
 * -s EXPORTED_FUNCTIONS in CMakeLists.txt / build-wasm.sh.
 * This file adds any additional runtime helpers.
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/bind.h>
#include "streetview_wasm.h"
#include <vector>

// ---------------------------------------------------------------------------
// Convenience wrapper: return a JS Float32Array view into WASM heap memory.
// ---------------------------------------------------------------------------
emscripten::val fill_noise_buffer_js(int width, int height,
                                      float scale, float offsetX, float offsetY) {
    std::vector<float> buf(static_cast<size_t>(width) * static_cast<size_t>(height));
    sw_fill_noise_buffer(buf.data(), width, height, scale, offsetX, offsetY);
    return emscripten::val(
        emscripten::typed_memory_view(buf.size(), buf.data())
    );
}

EMSCRIPTEN_BINDINGS(streetview_wasm_module) {
    emscripten::function("seed",            &sw_seed);
    emscripten::function("noise2d",         &sw_noise2d);
    emscripten::function("haversine",       &sw_haversine);
    emscripten::function("normalizeAngle",  &sw_normalize_angle);
    emscripten::function("signedAngleDiff", &sw_signed_angle_diff);
    emscripten::function("fillNoiseBuffer", &fill_noise_buffer_js);
}
#endif // __EMSCRIPTEN__
