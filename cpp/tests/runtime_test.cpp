/**
 * cpp/tests/runtime_test.cpp
 *
 * runtime.cpp — the heap and stack-bound exports the loader builds its
 * scratch arena on — compiled and run on the host like every other TU (it used
 * to be bindings.cpp, an #ifdef __EMSCRIPTEN__ wall the host never saw).
 */

#include "doctest.h"

#include "streetview/abi.h"

#include <cstdint>

TEST_CASE("sv_malloc / sv_free: 8-byte aligned, nullptr-safe") {
    void* p = sv_malloc(24);
    REQUIRE(p != nullptr);
    CHECK(reinterpret_cast<uintptr_t>(p) % 8 == 0);
    sv_free(p);
    sv_free(nullptr);
}

TEST_CASE("sv_stack_base / sv_stack_end: the shadow stack as wasm, 0 on the host") {
#ifdef __EMSCRIPTEN__
    // The stack grows down from the base; the heap sits above it.
    CHECK(sv_stack_base() > sv_stack_end());
    void* p = sv_malloc(16);
    CHECK(reinterpret_cast<uintptr_t>(p) >= sv_stack_base());
    sv_free(p);
#else
    CHECK(sv_stack_base() == 0);
    CHECK(sv_stack_end() == 0);
#endif
}
