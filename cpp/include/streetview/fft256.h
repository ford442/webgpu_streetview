#pragma once
/**
 * streetview/fft256.h
 * The cabin convolver's FFT: a fixed 256-point complex transform, radix-4
 * Stockham (four stages, natural-order output, no bit reversal), on split
 * re/im arrays, written once over sv_simd::f4 (streetview/simd.h).
 *
 * In-house rather than PFFFT/KissFFT because the goldens are compared bit for
 * bit across the scalar reference binary, the shipped SIMD binaries and the
 * host builds: those libraries sum in a different order on their SIMD and
 * scalar paths. Here the order is fixed by the source —
 *   - twiddles are constexpr (Taylor series in double, rounded once to f32),
 *     so every compiler bakes the same table;
 *   - each butterfly is the same lane-wise add/sub/mul sequence on every build;
 *   - a complex multiply is (xr*wr - xi*wi, xr*wi + xi*wr), in that order;
 *   - no FMA (-ffp-contract=off, SIMD128 has none).
 *
 *   fft256(re, im, tmp_re, tmp_im)   forward DFT in place, unscaled:
 *                                    X[k] = sum_n x[n] e^{-2 pi i nk/256}
 * The inverse is the same transform with re and im swapped on the way in and
 * out (IDFT(X) * 256 = swap(DFT(swap(X)))); callers fold the 1/256 into the
 * filter spectra, where it is an exact power-of-two scale.
 */

#include "streetview/simd.h"

namespace sv_fft {

constexpr int kN = 256;

namespace detail {

constexpr double kPi = 3.14159265358979323846;

/** sin(x) for |x| <= pi/4 — 13 Taylor terms, far below f32 resolution there. */
constexpr double taylor_sin(double x) {
    double term = x;
    double sum = x;
    const double x2 = x * x;
    for (int n = 1; n < 13; ++n) {
        term = -term * x2 / static_cast<double>((2 * n) * (2 * n + 1));
        sum += term;
    }
    return sum;
}

constexpr double taylor_cos(double x) {
    double term = 1.0;
    double sum = 1.0;
    const double x2 = x * x;
    for (int n = 1; n < 13; ++n) {
        term = -term * x2 / static_cast<double>((2 * n - 1) * (2 * n));
        sum += term;
    }
    return sum;
}

/** cos(2 pi k / 256) by exact octant symmetry, then a Taylor series on [0, pi/4]. */
constexpr double cos_k(int k) {
    k &= kN - 1;
    const int quadrant = k / 64;
    const int r = k % 64;
    // cos(q pi/2 + t) for t = pi r / 128 in [0, pi/2).
    const auto c = [](int rr) {
        return rr <= 32 ? taylor_cos(kPi * rr / 128.0) : taylor_sin(kPi * (64 - rr) / 128.0);
    };
    const auto s = [](int rr) {
        return rr <= 32 ? taylor_sin(kPi * rr / 128.0) : taylor_cos(kPi * (64 - rr) / 128.0);
    };
    switch (quadrant) {
    case 0: return c(r);
    case 1: return -s(r);
    case 2: return -c(r);
    default: return s(r);
    }
}

constexpr double sin_k(int k) { return cos_k(k - 64); }

struct Twiddles {
    float cos[kN];
    float sin[kN];
    // Stage 1 (s = 1) vectorises across p, so it reads w^p, w^2p, w^3p as
    // contiguous rows; later stages splat one twiddle per p.
    float s1_re[3][64];
    float s1_im[3][64];
};

constexpr Twiddles make_twiddles() {
    Twiddles t{};
    for (int k = 0; k < kN; ++k) {
        t.cos[k] = static_cast<float>(cos_k(k));
        t.sin[k] = static_cast<float>(sin_k(k));
    }
    for (int m = 0; m < 3; ++m) {
        for (int p = 0; p < 64; ++p) {
            const int k = ((m + 1) * p) & (kN - 1);
            t.s1_re[m][p] = t.cos[k];
            t.s1_im[m][p] = -t.sin[k];
        }
    }
    return t;
}

inline constexpr Twiddles kTw = make_twiddles();

using sv_simd::f4;

/** (xr + i xi)(wr + i wi), the one canonical order. */
inline void cmul(f4 xr, f4 xi, f4 wr, f4 wi, f4& yr, f4& yi) {
    yr = sv_simd::sub(sv_simd::mul(xr, wr), sv_simd::mul(xi, wi));
    yi = sv_simd::add(sv_simd::mul(xr, wi), sv_simd::mul(xi, wr));
}

/**
 * One radix-4 butterfly on four lanes. Outputs y0..y3 (before the twiddles
 * of y1..y3): a+c+b+d, (a-c) - j(b-d), (a+c)-(b+d), (a-c) + j(b-d), with
 * j(b-d) = (-(b-d).im, (b-d).re).
 */
struct Bfly {
    f4 r[4];
    f4 i[4];
};

inline Bfly butterfly(f4 ar, f4 ai, f4 br, f4 bi, f4 cr, f4 ci, f4 dr, f4 di) {
    using namespace sv_simd;
    const f4 apc_r = add(ar, cr);
    const f4 apc_i = add(ai, ci);
    const f4 amc_r = sub(ar, cr);
    const f4 amc_i = sub(ai, ci);
    const f4 bpd_r = add(br, dr);
    const f4 bpd_i = add(bi, di);
    const f4 bmd_r = sub(br, dr);
    const f4 bmd_i = sub(bi, di);
    Bfly o{};
    o.r[0] = add(apc_r, bpd_r);
    o.i[0] = add(apc_i, bpd_i);
    o.r[1] = add(amc_r, bmd_i);   // amc - j*bmd
    o.i[1] = sub(amc_i, bmd_r);
    o.r[2] = sub(apc_r, bpd_r);
    o.i[2] = sub(apc_i, bpd_i);
    o.r[3] = sub(amc_r, bmd_i);   // amc + j*bmd
    o.i[3] = add(amc_i, bmd_r);
    return o;
}

/** Stage 1 (n = 256, s = 1): 64 butterflies, vectorised across p, outputs interleaved. */
inline void stage_first(const float* xr, const float* xi, float* yr, float* yi) {
    using namespace sv_simd;
    for (int p = 0; p < 64; p += 4) {
        Bfly o = butterfly(load(xr + p), load(xi + p), load(xr + p + 64), load(xi + p + 64),
                           load(xr + p + 128), load(xi + p + 128), load(xr + p + 192),
                           load(xi + p + 192));
        for (int m = 1; m < 4; ++m) {
            cmul(o.r[m], o.i[m], load(kTw.s1_re[m - 1] + p), load(kTw.s1_im[m - 1] + p), o.r[m],
                 o.i[m]);
        }
        // Lane l of o.r[m] belongs at y[4 (p + l) + m]: transpose so each
        // vector is one p's four outputs, then store 16 contiguous floats.
        transpose(o.r[0], o.r[1], o.r[2], o.r[3]);
        transpose(o.i[0], o.i[1], o.i[2], o.i[3]);
        for (int l = 0; l < 4; ++l) {
            const int at = 4 * (p + l);
            store(yr + at, o.r[l]);
            store(yi + at, o.i[l]);
        }
    }
}

/** A later stage: sub-transform length n, stride s (n * s = 256, s >= 4). */
inline void stage(int n, int s, const float* xr, const float* xi, float* yr, float* yi) {
    using namespace sv_simd;
    const int n1 = n / 4;
    const int span = s * n1;
    for (int p = 0; p < n1; ++p) {
        const int k = p * s;
        f4 wr[3];
        f4 wi[3];
        for (int m = 0; m < 3; ++m) {
            const int km = ((m + 1) * k) & (kN - 1);
            wr[m] = splat(kTw.cos[km]);
            wi[m] = splat(-kTw.sin[km]);
        }
        for (int q = 0; q < s; q += 4) {
            const int a = q + s * p;
            const int b = a + span;
            const int c = b + span;
            const int d = c + span;
            Bfly o = butterfly(load(xr + a), load(xi + a), load(xr + b), load(xi + b),
                               load(xr + c), load(xi + c), load(xr + d), load(xi + d));
            // p == 0 has unit twiddles: skipped on every build alike.
            if (p != 0) {
                for (int m = 1; m < 4; ++m) cmul(o.r[m], o.i[m], wr[m - 1], wi[m - 1], o.r[m], o.i[m]);
            }
            int out = q + s * 4 * p;
            for (int m = 0; m < 4; ++m, out += s) {
                store(yr + out, o.r[m]);
                store(yi + out, o.i[m]);
            }
        }
    }
}

} // namespace detail

/**
 * Forward 256-point DFT of (re, im) in place; tmp_re/tmp_im are 256-float
 * scratch. No allocation, no globals written.
 */
inline void fft256(float* re, float* im, float* tmp_re, float* tmp_im) {
    detail::stage_first(re, im, tmp_re, tmp_im);   // n = 256, s = 1
    detail::stage(64, 4, tmp_re, tmp_im, re, im);
    detail::stage(16, 16, re, im, tmp_re, tmp_im);
    detail::stage(4, 64, tmp_re, tmp_im, re, im);
}

} // namespace sv_fft
