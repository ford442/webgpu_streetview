cmake_minimum_required(VERSION 3.16)
project(streetview_wasm CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# clangd / clang-tidy pick this up from cpp/build-host (see docs/WASM_BRIDGE.md).
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
option(STREETVIEW_WERROR "Treat compiler warnings as errors" ON)
option(STREETVIEW_SANITIZERS "Build the host targets with ASan + UBSan" OFF)
option(STREETVIEW_WASM_SIMD
       "Allow the Emscripten build to autovectorize with WASM SIMD128" OFF)

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

if(EMSCRIPTEN)
    # -----------------------------------------------------------------------
    # WASM target (Emscripten)
    # -----------------------------------------------------------------------
    # The output WASM must be ABI-compatible with the WAT module and the
    # TypeScript loader in src/wasm/index.ts.  Key requirements:
    #
    #   - No MODULARIZE / EXPORT_ES6 / JS glue wrapper — the TS loader
    #     instantiates the .wasm binary directly via WebAssembly.instantiate().
    #   - No embind (--bind) — raw C exports are used instead.
    #   - Exported function names match the WAT module exactly:
    #       seed, noise2d, fill_noise_buffer, fbm2d, fill_fbm_buffer,
    #       fill_particle_seeds, haversine, batch_haversine,
    #       normalize_angle, signed_angle_diff, fill_engine_noise,
    #       luma_histogram_bt709, reduce_luma_bt709, downsample_2d
    #     src/wasm/__tests__/wasmAbiLock.test.ts fails if this list, the WAT
    #     exports and the TypeScript loader ever drift apart.
    #     These are thin wrappers (in bindings.cpp) around the sw_* functions
    #     in noise_module.cpp.
    #   - STANDALONE_WASM=1 links math (sin/cos/atan2) statically so the
    #     binary has no host math imports, matching the fact that the WAT
    #     module uses env.sin/cos/atan2 but the Emscripten binary does not.
    #     The TS loader's importObject supplies those env stubs regardless;
    #     extra keys in the import object are silently ignored by the runtime.
    add_executable(streetview-wasm
        src/noise_module.cpp
        src/bindings.cpp
    )
    target_include_directories(streetview-wasm PRIVATE include)
    target_compile_options(streetview-wasm PRIVATE
        -O3
        ${STREETVIEW_WARNINGS}
        # STANDALONE_WASM already builds without them; being explicit keeps a
        # stray throw or dynamic_cast from silently pulling in the runtime.
        -fno-exceptions
        -fno-rtti
    )

    # Optional SIMD128. The algorithms stay scalar C++ — this only lets the
    # compiler autovectorize the fill_* loops. WASM SIMD128 has no FMA and we
    # never pass -ffast-math, so vectorized results stay bit-identical to the
    # scalar goldens; cpp/tests asserts that invariant on the host build.
    if(STREETVIEW_WASM_SIMD)
        target_compile_options(streetview-wasm PRIVATE -msimd128)
        message(STATUS "streetview-wasm: SIMD128 autovectorization ENABLED")
    endif()

    set(EMSCRIPTEN_FLAGS
        "-O3"
        "-g0"
        "-s WASM=1"
        "-s STANDALONE_WASM=1"
        "--no-entry"
        # 16 MiB up front covers the largest tile the renderer asks for without
        # a first-frame grow; growth stays on for the batch-geodesy paths.
        "-s INITIAL_MEMORY=16777216"
        "-s ALLOW_MEMORY_GROWTH=1"
        "-s ASSERTIONS=0"
        "-s EXPORTED_FUNCTIONS=['_seed','_noise2d','_fill_noise_buffer','_fbm2d','_fill_fbm_buffer','_fill_particle_seeds','_haversine','_batch_haversine','_normalize_angle','_signed_angle_diff','_fill_engine_noise','_luma_histogram_bt709','_reduce_luma_bt709','_downsample_2d','_malloc','_free']"
        "-s EXPORTED_RUNTIME_METHODS=[]"
    )

    # Join list into a single string for linker flags.
    string(JOIN " " EMSCRIPTEN_LINK_FLAGS ${EMSCRIPTEN_FLAGS})

    set_target_properties(streetview-wasm PROPERTIES
        SUFFIX ".wasm"
        LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../public/wasm"
    )
else()
    # -----------------------------------------------------------------------
    # Host target (system compiler — no Emscripten, no browser)
    # -----------------------------------------------------------------------
    # Same algorithms, compiled natively so `ctest` can assert them against the
    # golden vectors captured from the shipping WASM binary. bindings.cpp is
    # not part of this target: it is entirely inside `#ifdef __EMSCRIPTEN__`
    # and only exists to re-export the sw_* functions under their ABI names.
    add_library(streetview_cpu STATIC src/noise_module.cpp)
    target_include_directories(streetview_cpu PUBLIC include)
    target_compile_options(streetview_cpu PRIVATE ${STREETVIEW_WARNINGS})

    if(STREETVIEW_SANITIZERS)
        if(MSVC)
            message(FATAL_ERROR "STREETVIEW_SANITIZERS is not supported with MSVC")
        endif()
        target_compile_options(streetview_cpu PUBLIC
            -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(streetview_cpu PUBLIC -fsanitize=address,undefined)
        message(STATUS "streetview_cpu: ASan + UBSan ENABLED")
    endif()

    include(CTest)
    if(BUILD_TESTING)
        add_subdirectory(tests)
    endif()
endif()
