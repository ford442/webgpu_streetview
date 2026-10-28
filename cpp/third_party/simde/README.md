# SIMDe (vendored subset)

[SIMD Everywhere](https://github.com/simd-everywhere/simde) v0.8.2, MIT (`COPYING`).
Release tarball sha256 `ed2a3268658f2f2a9b5367628a85ccd4cf9516460ed8604eed369653d49b25fb`.

Only `simde/wasm/simd128.h` and the 11 headers it includes are vendored. They
let the host build compile the `__wasm_simd128__` paths of the C++ layer
natively (`streetview/simd.h` with `SV_SIMDE`), so the code the AudioWorklet
ships runs under ASan/UBSan and the doctest property tests
(`streetview_simd_tests`). Host tests only — never part of the emcc build.

To update: download a release, re-run the include closure
(`g++ -MM` on a file that includes `<simde/wasm/simd128.h>`), copy exactly
those headers, and update the version and hash above.
