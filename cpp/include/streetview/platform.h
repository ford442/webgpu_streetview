#pragma once
/**
 * streetview/platform.h
 * The few things that differ between the emcc build and the host build, so
 * every translation unit — the ABI included — compiles under g++/clang
 * -Werror, ASan/UBSan and clang-tidy on the host.
 *
 *   SV_EXPORT(name)   on a declaration in abi.h: export the function from the
 *                     wasm binary as `name`. `used` keeps LTO from dropping it
 *                     before wasm-ld sees the export. Only a binary that links
 *                     the defining TU exports it — streetview-dsp.simd.wasm
 *                     links cabin_dsp_module.cpp alone, so it exports dsp_*
 *                     and nothing else. Nothing on the host.
 *   sv_platform::stack_base / stack_end
 *                     the emscripten shadow-stack bounds; 0 on the host,
 *                     where there is no separate shadow stack to check.
 */

#ifdef __cplusplus
#include <cstdint>
#else
#include <stdint.h>
#endif

#if defined(__EMSCRIPTEN__) || defined(__wasm__)
// Standard-attribute spelling in C++: it may precede [[nodiscard]] (a GNU
// __attribute__ list there is an error before clang 2x).
#ifdef __cplusplus
#define SV_EXPORT(name) [[clang::export_name(#name), gnu::used]]
#else
#define SV_EXPORT(name) __attribute__((export_name(#name), used))
#endif
#else
#define SV_EXPORT(name)
#endif

#ifdef __cplusplus
#ifdef __EMSCRIPTEN__
#include <emscripten/stack.h>
#endif

namespace sv_platform {

inline uintptr_t stack_base() {
#ifdef __EMSCRIPTEN__
    return emscripten_stack_get_base();
#else
    return 0;
#endif
}

inline uintptr_t stack_end() {
#ifdef __EMSCRIPTEN__
    return emscripten_stack_get_end();
#else
    return 0;
#endif
}

} // namespace sv_platform
#endif
