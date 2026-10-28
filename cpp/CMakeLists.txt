cmake_minimum_required(VERSION 3.16)
project(streetview_wasm CXX)

# emsdk is pinned in cpp/emsdk.version (CI and scripts/build-wasm.sh both
# enforce it) and supports -std=c++20; std::span/std::bit_cast make the
# conversion-heavy fill_* code under -Wconversion easier to get right. Bump the
# host compilers together with it so both sides of the ABI boundary build under
# the same mode.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# clangd / clang-tidy pick this up from cpp/build-host (see docs/WASM_BRIDGE.md).
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
option(STREETVIEW_WERROR "Treat compiler warnings as errors" ON)
option(STREETVIEW_SANITIZERS "Build the host targets with ASan + UBSan" OFF)
# With emcmake: build the doctest suite itself as wasm (-msimd128, run under
# node through CMAKE_CROSSCOMPILING_EMULATOR) instead of the shipped binaries.
# CI's wasm-sanitizers job: emcmake cmake -DSTREETVIEW_WASM_TESTS=ON
# -DSTREETVIEW_SANITIZERS=ON, so the code that ships is sanitized as wasm too.
option(STREETVIEW_WASM_TESTS "emcc: build and run the doctest suite as SIMD wasm" OFF)
option(STREETVIEW_FUZZ "host clang: build the libFuzzer harnesses in cpp/fuzz" OFF)

# ---------------------------------------------------------------------------
# Warning flags (applied to our sources only — never to cpp/third_party)
# ---------------------------------------------------------------------------
if(MSVC)
    set(STREETVIEW_WARNINGS /W4)
    if(STREETVIEW_WERROR)
        list(APPEND STREETVIEW_WARNINGS /WX)
    endif()
else()
    set(STREETVIEW_WARNINGS -Wall -Wextra -Wpedantic -Wshadow -Wconversion)
    if(STREETVIEW_WERROR)
        list(APPEND STREETVIEW_WARNINGS -Werror)
    endif()
endif()

# -Wdouble-promotion, host only: the algorithms mix f32 (noise, particle
# seeds, engine audio) with f64 (haversine), and this flags an accidental
# float silently widened into a double expression. Not applied to the
# Emscripten target below — that stays scoped to what CI's two host
# compilers (g++, clang++) already gate on every push.
set(STREETVIEW_HOST_WARNINGS ${STREETVIEW_WARNINGS})
if(NOT MSVC)
    list(APPEND STREETVIEW_HOST_WARNINGS -Wdouble-promotion)
endif()

# ---------------------------------------------------------------------------
# Floating-point codegen (every target: emcc, host library and host tests)
# ---------------------------------------------------------------------------
# The goldens are compared bit-for-bit (memcmp), so a*b+c must round twice on
# every compiler. clang contracts it into one FMA by default wherever the
# target has one (aarch64, -march=x86-64-v3 / native), which silently breaks
# `npm run test:cpp` on Apple Silicon. CI's x86-64-v3 clang job keeps this
# honest. MSVC's default /fp:precise does not contract across statements.
set(STREETVIEW_FP_FLAGS "")
if(NOT MSVC)
    set(STREETVIEW_FP_FLAGS -ffp-contract=off)
endif()

# ---------------------------------------------------------------------------
# Sources — one list for the emcc binaries and the host library, so a new TU
# cannot be linted/tested on one side and shipped untested on the other.
# scripts/lint-cpp.sh and scripts/wasm-source-hash.mjs read nothing from here:
# keep them in step when a TU is added (wasmAbiLock.test.ts checks all three).
# ---------------------------------------------------------------------------
set(STREETVIEW_SOURCES
    src/noise_module.cpp
    src/geodesy_module.cpp
    src/audio_module.cpp
    src/hrtf_module.cpp
    src/luma_module.cpp
    src/cabin_dsp_module.cpp
    src/depth_module.cpp
    src/graph_module.cpp
    src/runtime.cpp
)
# The AudioWorklet's binary: the cabin engine and the heap, nothing else.
set(STREETVIEW_DSP_SOURCES
    src/cabin_dsp_module.cpp
    src/runtime.cpp
)

if(EMSCRIPTEN AND NOT STREETVIEW_WASM_TESTS)
    # -----------------------------------------------------------------------
    # WASM targets (Emscripten)
    # -----------------------------------------------------------------------
    # The output WASM must be ABI-compatible with the TypeScript loader in
    # src/wasm/index.ts.  Key requirements:
    #
    #   - No MODULARIZE / EXPORT_ES6 / JS glue wrapper — the TS loader
    #     instantiates the .wasm binary directly via WebAssembly.instantiate().
    #   - No embind (--bind), no EXPORTED_FUNCTIONS: every export is declared
    #     once with SV_EXPORT in include/streetview/abi.h (wasm export_name),
    #     so a binary exports exactly the functions of the TUs it links.
    #     scripts/check-wasm-abi.mjs compares each export's *signature* (the
    #     type section) with src/wasm/abi.generated.ts.
    #   - STANDALONE_WASM=1 links math (sin/cos/atan2) statically. The main
    #     binaries' only import is env.emscripten_notify_memory_growth
    #     (ALLOW_MEMORY_GROWTH); the DSP binary has none. The loaders call
    #     `_initialize` when present.
    #
    # Three binaries:
    #   streetview-wasm.wasm        scalar — never deployed; the reference CI
    #                               builds and golden-tests (the oracle the
    #                               goldens are generated from)
    #   streetview-wasm.simd.wasm   SIMD128 — every main-thread kernel
    #   streetview-dsp.simd.wasm    SIMD128, cabin_dsp_module.cpp only, fixed
    #                               memory (no memory.grow on the real-time
    #                               thread), emmalloc — the AudioWorklet
    # All three must reproduce cpp/tests/goldens.json bit for bit.
    # They land in ${CMAKE_BINARY_DIR}/out; scripts/build-wasm.sh --update
    # copies the shipped ones into the tracked public/wasm/.
    add_executable(streetview-wasm ${STREETVIEW_SOURCES})
    add_executable(streetview-wasm-simd ${STREETVIEW_SOURCES})
    add_executable(streetview-dsp-simd ${STREETVIEW_DSP_SOURCES})
    set(STREETVIEW_WASM_TARGETS streetview-wasm streetview-wasm-simd streetview-dsp-simd)

    # Optimisation comes from CMAKE_BUILD_TYPE alone (Release: -O3 -DNDEBUG,
    # Debug: -g) — build-wasm.sh passes no CMAKE_CXX_FLAGS. The link step
    # needs its own level because it also drives wasm-opt.
    # Release adds -flto (compile + link): with -ffp-contract=off and no
    # -ffast-math, LTO may inline across the TUs but never re-associate or
    # fuse float ops, so the binaries reproduce the goldens bit for bit (CI's
    # `--compare` step and wasmGoldenParity.test.ts prove it on every build).
    # Debug keeps runtime assertions instead; it is never shipped.
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(STREETVIEW_WASM_LINK_OPT "-O0" "-g" "-sASSERTIONS=1")
        set(STREETVIEW_WASM_LTO "")
    else()
        set(STREETVIEW_WASM_LINK_OPT "-O3" "-g0" "-flto" "-sASSERTIONS=0")
        set(STREETVIEW_WASM_LTO -flto)
    endif()

    set(STREETVIEW_WASM_COMMON_LINK
        ${STREETVIEW_WASM_LINK_OPT}
        # STRICT: no deprecated settings or legacy defaults can creep in.
        "-sSTRICT=1"
        "-sSTANDALONE_WASM=1"
        "--no-entry"
        "-sEXPORTED_RUNTIME_METHODS=[]"
    )
    set(STREETVIEW_WASM_MAIN_LINK
        # 16 MiB up front covers every per-frame buffer (noise tiles, the
        # quarter-res luma chore, a 256² depth map) without a first-frame grow.
        "-sINITIAL_MEMORY=16777216"
        "-sALLOW_MEMORY_GROWTH=1"
        # An explicit ceiling, never unbounded. The scratch arena shrinks back
        # after an idle second (src/wasm/marshal.ts) and full-resolution
        # snapshots are downsampled on the GPU, so nothing near this is live.
        "-sMAXIMUM_MEMORY=134217728"
        # 64 KiB of shadow stack, explicitly: the loader checks it
        # (sv_stack_base - sv_stack_end must equal WASM_STACK_SIZE in
        # src/wasm/marshal.ts) and puts the scratch arena above it. #300's
        # corruption was an assumption about exactly this number.
        "-sSTACK_SIZE=65536"
    )
    set(STREETVIEW_WASM_DSP_LINK
        # Fixed memory: the real-time thread can never grow (and so never
        # detach its views or stall on a grow). 1 MiB holds one engine at
        # 16384 taps (~530 KiB of IR spectra and FDL), its I/O block and the
        # stack; check-wasm-abi.mjs asserts the binary has no memory.grow.
        "-sINITIAL_MEMORY=1048576"
        "-sALLOW_MEMORY_GROWTH=0"
        "-sSTACK_SIZE=16384"
        # A few hundred bytes instead of dlmalloc: the engine makes two
        # allocations for the life of the node.
        "-sMALLOC=emmalloc"
    )
    # The SIMD binaries pin every feature they use, on compile and link, so a
    # change of emcc defaults cannot change what the shipped binary requires.
    # Bulk memory and non-trapping float-to-int were already on implicitly
    # (emsdk 6 defaults): the browser floor is SIMD128 + those, i.e. Safari
    # 16.4 / Chrome 91 / Firefox 89 — every WebGPU-capable browser.
    # Never -mrelaxed-simd: relaxed madd is FMA on some engines and not others.
    set(STREETVIEW_WASM_SIMD_FEATURES
        -msimd128 -mbulk-memory -mnontrapping-fptoint -msign-ext -mmutable-globals)

    foreach(target IN LISTS STREETVIEW_WASM_TARGETS)
        target_include_directories(${target} PRIVATE include)
        target_compile_options(${target} PRIVATE
            ${STREETVIEW_FP_FLAGS}
            ${STREETVIEW_WARNINGS}
            # STANDALONE_WASM already builds without them; being explicit keeps a
            # stray throw or dynamic_cast from silently pulling in the runtime.
            -fno-exceptions
            -fno-rtti
            ${STREETVIEW_WASM_LTO}
        )
        target_link_options(${target} PRIVATE ${STREETVIEW_WASM_COMMON_LINK})
        set_target_properties(${target} PROPERTIES
            SUFFIX ".wasm"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
        )
    endforeach()
    target_link_options(streetview-wasm PRIVATE ${STREETVIEW_WASM_MAIN_LINK})
    target_link_options(streetview-wasm-simd PRIVATE ${STREETVIEW_WASM_MAIN_LINK})
    target_link_options(streetview-dsp-simd PRIVATE ${STREETVIEW_WASM_DSP_LINK})

    # SIMD128: -msimd128 defines __wasm_simd128__, which switches
    # cabin_dsp_module.cpp's direct partition, FFT and spectral MAC to f32x4
    # intrinsics, and lets the compiler autovectorize the rest. WASM SIMD128
    # has no FMA and we never pass -ffast-math, so every result stays
    # bit-identical to the scalar goldens. Linked with the same flags so emcc
    # runs wasm-opt with exactly these features.
    foreach(target IN ITEMS streetview-wasm-simd streetview-dsp-simd)
        target_compile_options(${target} PRIVATE ${STREETVIEW_WASM_SIMD_FEATURES})
        target_link_options(${target} PRIVATE ${STREETVIEW_WASM_SIMD_FEATURES})
    endforeach()
    set_target_properties(streetview-wasm-simd PROPERTIES OUTPUT_NAME "streetview-wasm.simd")
    set_target_properties(streetview-dsp-simd PROPERTIES OUTPUT_NAME "streetview-dsp.simd")
else()
    # -----------------------------------------------------------------------
    # Host target (system compiler — no Emscripten, no browser)
    # -----------------------------------------------------------------------
    # Same sources, compiled natively (or, with STREETVIEW_WASM_TESTS, as
    # -msimd128 wasm run under node) so `ctest` can assert them against the
    # golden vectors captured from the reference WASM binary. runtime.cpp
    # included: nothing is behind #ifdef __EMSCRIPTEN__ any more, so the host
    # -Werror builds, ASan/UBSan and clang-tidy see the whole ABI.
    add_library(streetview_cpu STATIC ${STREETVIEW_SOURCES})
    target_include_directories(streetview_cpu PUBLIC include)
    target_compile_options(streetview_cpu PRIVATE ${STREETVIEW_HOST_WARNINGS})
    # PUBLIC so the test executable (which links this) inherits it too.
    target_compile_options(streetview_cpu PUBLIC ${STREETVIEW_FP_FLAGS})

    # Only the non-sanitizer `build-host` tree may write cpp/compile_commands.json.
    # ASan (`build-asan`) and the clang extra tree (`build-clang`) keep their own
    # databases inside the build dir. A symlink to ${CMAKE_BINARY_DIR} used to
    # follow whichever host target last built, so `clang-tidy -p cpp` and editors
    # that ignore cpp/.clangd picked up -fsanitize=address,undefined after
    # `npm run test:cpp:asan`. Copy (not symlink) the host database so the file
    # is a snapshot of build-host flags. POST_BUILD because CMake writes
    # compile_commands.json during generate, after CMakeLists.txt processing.
    get_filename_component(_sv_build_dir_name "${CMAKE_BINARY_DIR}" NAME)
    if(NOT STREETVIEW_SANITIZERS AND _sv_build_dir_name STREQUAL "build-host")
        add_custom_command(TARGET streetview_cpu POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${CMAKE_BINARY_DIR}/compile_commands.json"
                    "${CMAKE_SOURCE_DIR}/compile_commands.json"
            COMMENT "Copying build-host compile_commands.json into cpp/ for clang-tidy -p cpp"
        )
    endif()

    # The same sources again with SV_SIMDE: streetview/simd.h takes the
    # wasm_simd128 intrinsics path through SIMDe (cpp/third_party/simde), so
    # the SIMD code the binaries ship — the convolver's direct partition, FFT
    # and spectral MAC — compiles natively and runs the whole doctest suite,
    # goldens included, in every host job (ASan/UBSan too). SIMDe is SYSTEM:
    # the -Werror wall is for our code.
    add_library(streetview_cpu_simd STATIC ${STREETVIEW_SOURCES})
    target_include_directories(streetview_cpu_simd PUBLIC include)
    target_include_directories(streetview_cpu_simd SYSTEM PUBLIC third_party/simde)
    target_compile_definitions(streetview_cpu_simd PUBLIC SV_SIMDE)
    target_compile_options(streetview_cpu_simd PRIVATE ${STREETVIEW_HOST_WARNINGS})
    target_compile_options(streetview_cpu_simd PUBLIC ${STREETVIEW_FP_FLAGS})

    if(EMSCRIPTEN)
        # The suite as wasm: the SIMD128 paths (SV_SIMDE is moot here — the
        # real wasm_simd128.h wins in streetview/simd.h), exceptions off like
        # the shipped binaries, enough memory for ASan's shadow.
        set(STREETVIEW_WASM_SIMD_FEATURES
            -msimd128 -mbulk-memory -mnontrapping-fptoint -msign-ext -mmutable-globals)
        foreach(lib IN ITEMS streetview_cpu streetview_cpu_simd)
            target_compile_options(${lib} PUBLIC ${STREETVIEW_WASM_SIMD_FEATURES})
            target_link_options(${lib} PUBLIC ${STREETVIEW_WASM_SIMD_FEATURES}
                -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=1048576
                -sEXIT_RUNTIME=1)
        endforeach()
    endif()

    if(STREETVIEW_SANITIZERS)
        if(MSVC)
            message(FATAL_ERROR "STREETVIEW_SANITIZERS is not supported with MSVC")
        endif()
        foreach(lib IN ITEMS streetview_cpu streetview_cpu_simd)
            target_compile_options(${lib} PUBLIC
                -fsanitize=address,undefined -fno-omit-frame-pointer)
            target_link_options(${lib} PUBLIC -fsanitize=address,undefined)
        endforeach()
        message(STATUS "streetview_cpu{,_simd}: ASan + UBSan ENABLED")
    endif()

    include(CTest)
    if(BUILD_TESTING)
        add_subdirectory(tests)
    endif()
    if(STREETVIEW_FUZZ AND NOT EMSCRIPTEN)
        add_subdirectory(fuzz)
    endif()
endif()
