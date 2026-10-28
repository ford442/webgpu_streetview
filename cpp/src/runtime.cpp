/**
 * runtime.cpp
 * The runtime half of the ABI (streetview/abi.h): the heap and the
 * shadow-stack bounds the TypeScript loader builds its scratch arena on.
 *
 * This used to be bindings.cpp, a 230-line layer of EMSCRIPTEN_KEEPALIVE
 * wrappers renaming every sw_* kernel, wrapped in #ifdef __EMSCRIPTEN__ — so
 * the host -Werror builds, ASan/UBSan and clang-tidy saw an empty TU. The
 * kernels now export themselves (SV_EXPORT in abi.h) and the emcc-only bits
 * live behind streetview/platform.h, so everything here compiles and is
 * tested on the host too (cpp/tests/runtime_test.cpp).
 *
 * Every pointer argument a kernel takes is an offset into linear memory that
 * the loader got from sv_malloc (the scratch arena in src/wasm/marshal.ts),
 * so it sits in the heap — above C++ statics *and* above the shadow stack,
 * which grows down from sv_stack_base. Never hand a kernel a fixed offset:
 * 64 KiB used to overlap the top of the stack, and libm's sin/cos spill
 * frames there (the batch_haversine corruption at |lat| > 45°).
 */

#include "streetview/abi.h"
#include <cstdint>
#include <cstdlib>

/*
 * The element types the TS loader views linear memory through (src/wasm/index.ts,
 * the cabin worklet): a size change here would make every kernel read garbage
 * without a single ABI-lock failure, so it fails the build instead.
 */
static_assert(sizeof(float) == 4, "Float32Array views: tiles, PCM, IRs, depth maps, luma stats");
static_assert(sizeof(double) == 8, "Float64Array views: polylines, offset_latlng, depth state3");
static_assert(sizeof(int) == 4, "Int32Array views: CSR offsets/neighbors, paths");
static_assert(sizeof(unsigned int) == 4, "Uint32Array views: luma histogram bins");
static_assert(sizeof(unsigned char) == 1, "Uint8Array views: packed RGBA8");
static_assert(alignof(double) <= 8, "the scratch arena is 8-byte aligned (src/wasm/marshal.ts)");
#if defined(__EMSCRIPTEN__) || defined(__wasm__)
static_assert(sizeof(void*) == 4, "wasm32: every pointer argument is a JS number offset");
#endif

extern "C" {

void* sv_malloc(size_t bytes) {
    return std::malloc(bytes);
}

void sv_free(void* ptr) {
    std::free(ptr);
}

uintptr_t sv_stack_base(void) {
    return sv_platform::stack_base();
}

uintptr_t sv_stack_end(void) {
    return sv_platform::stack_end();
}

} // extern "C"
