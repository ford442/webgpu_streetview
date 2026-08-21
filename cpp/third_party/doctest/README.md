# doctest (vendored)

Single-header C++ test framework used by the native (non-Emscripten) host test
target in `cpp/tests`.

- Upstream: https://github.com/doctest/doctest
- Version: **v2.4.11**
- Files: `doctest.h` (verbatim), `LICENSE.txt` (MIT)

Vendored rather than fetched so `cmake -S cpp -B cpp/build-host && ctest` works
offline and CI needs no package step. It is included as a *system* header in
`cpp/tests/CMakeLists.txt`, so the `-Werror` wall we put on our own sources does
not apply to third-party code.

To update: drop in a new `doctest.h` + `LICENSE.txt` from the upstream tag and
bump the version above. Do not hand-edit the header.
