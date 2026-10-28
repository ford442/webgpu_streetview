#pragma once
/**
 * streetview/simd.h
 * The 4-lane f32 vector the cabin convolver is written in, one source for
 * every build:
 *
 *   emcc -msimd128   wasm SIMD128 intrinsics (<wasm_simd128.h>) — what ships
 *   host + SV_SIMDE  the same intrinsics through SIMDe (cpp/third_party/simde),
 *                    so the shipped SIMD path runs natively under ASan/UBSan
 *                    and the doctest property tests (streetview_simd_tests)
 *   otherwise        a struct of four floats with the same per-lane ops — the
 *                    scalar reference binary and the plain host build
 *
 * Every operation is lane-wise IEEE add/sub/mul or exact data movement
 * (load/store/splat/transpose). There is no FMA in SIMD128 (and never
 * -mrelaxed-simd), no horizontal reduction and -ffp-contract=off everywhere,
 * so all three agree to the last bit by construction.
 */

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#define SV_SIMD128 1
#elif defined(SV_SIMDE)
#define SIMDE_ENABLE_NATIVE_ALIASES
#include <simde/wasm/simd128.h>
#define SV_SIMD128 1
#else
#define SV_SIMD128 0
#endif

namespace sv_simd {

#if SV_SIMD128
using f4 = v128_t;

inline f4 load(const float* p) {
    return wasm_v128_load(p);
}
inline void store(float* p, f4 v) {
    wasm_v128_store(p, v);
}
inline f4 splat(float x) {
    return wasm_f32x4_splat(x);
}
inline f4 add(f4 a, f4 b) {
    return wasm_f32x4_add(a, b);
}
inline f4 sub(f4 a, f4 b) {
    return wasm_f32x4_sub(a, b);
}
inline f4 mul(f4 a, f4 b) {
    return wasm_f32x4_mul(a, b);
}

/** (l0 + l1) + (l2 + l3) — the FIR's canonical lane reduction. */
inline float hsum(f4 v) {
    return (wasm_f32x4_extract_lane(v, 0) + wasm_f32x4_extract_lane(v, 1)) +
           (wasm_f32x4_extract_lane(v, 2) + wasm_f32x4_extract_lane(v, 3));
}

/** In place: rows (a, b, c, d) become columns. */
inline void transpose(f4& a, f4& b, f4& c, f4& d) {
    const f4 t0 = wasm_i32x4_shuffle(a, b, 0, 4, 1, 5);
    const f4 t1 = wasm_i32x4_shuffle(a, b, 2, 6, 3, 7);
    const f4 t2 = wasm_i32x4_shuffle(c, d, 0, 4, 1, 5);
    const f4 t3 = wasm_i32x4_shuffle(c, d, 2, 6, 3, 7);
    a = wasm_i32x4_shuffle(t0, t2, 0, 1, 4, 5);
    b = wasm_i32x4_shuffle(t0, t2, 2, 3, 6, 7);
    c = wasm_i32x4_shuffle(t1, t3, 0, 1, 4, 5);
    d = wasm_i32x4_shuffle(t1, t3, 2, 3, 6, 7);
}
#else
struct f4 {
    float v[4];
};

inline f4 load(const float* p) {
    return {{p[0], p[1], p[2], p[3]}};
}
inline void store(float* p, f4 x) {
    p[0] = x.v[0];
    p[1] = x.v[1];
    p[2] = x.v[2];
    p[3] = x.v[3];
}
inline f4 splat(float x) {
    return {{x, x, x, x}};
}
inline f4 add(f4 a, f4 b) {
    return {{a.v[0] + b.v[0], a.v[1] + b.v[1], a.v[2] + b.v[2], a.v[3] + b.v[3]}};
}
inline f4 sub(f4 a, f4 b) {
    return {{a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2], a.v[3] - b.v[3]}};
}
inline f4 mul(f4 a, f4 b) {
    return {{a.v[0] * b.v[0], a.v[1] * b.v[1], a.v[2] * b.v[2], a.v[3] * b.v[3]}};
}

inline float hsum(f4 v) {
    return (v.v[0] + v.v[1]) + (v.v[2] + v.v[3]);
}

inline void transpose(f4& a, f4& b, f4& c, f4& d) {
    const f4 r0 = a;
    const f4 r1 = b;
    const f4 r2 = c;
    const f4 r3 = d;
    a = {{r0.v[0], r1.v[0], r2.v[0], r3.v[0]}};
    b = {{r0.v[1], r1.v[1], r2.v[1], r3.v[1]}};
    c = {{r0.v[2], r1.v[2], r2.v[2], r3.v[2]}};
    d = {{r0.v[3], r1.v[3], r2.v[3], r3.v[3]}};
}
#endif

} // namespace sv_simd
