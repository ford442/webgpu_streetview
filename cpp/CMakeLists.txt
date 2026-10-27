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

if(EMSCRIPTEN)
    # -----------------------------------------------------------------------
    # WASM target (Emscripten)
    # -----------------------------------------------------------------------
    # The output WASM must be ABI-compatible with the TypeScript loader in
    # src/wasm/index.ts.  Key requirements:
    #
    #   - No MODULARIZE / EXPORT_ES6 / JS glue wrapper — the TS loader
    #     instantiates the .wasm binary directly via WebAssembly.instantiate().
    #   - No embind (--bind) — raw C exports are used instead.
    #   - Exported function names match bindings.cpp:
    #       seed, noise2d, fill_noise_buffer, fbm2d, fill_fbm_buffer,
    #       fill_particle_seeds, haversine, batch_haversine, offset_latlng,
    #       normalize_angle, signed_angle_diff, initial_bearing,
    #       polyline_resample, polyline_project, fill_engine_noise,
    #       fill_cabin_ir, fill_hrtf, luma_histogram_bt709,
    #       reduce_luma_bt709, downsample_2d, luma_analyze, dsp_create,
    #       dsp_destroy, dsp_set_params, dsp_set_ir, dsp_render,
    #       dsp_max_ir_taps, depth_percentiles, depth_near_depth,
    #       depth_normalize, graph_astar, graph_nearest
    #     src/wasm/__tests__/wasmAbiLock.test.ts fails if this list, the
    #     bindings, and the TypeScript loader ever drift apart.
    #   - STANDALONE_WASM=1 links math (sin/cos/atan2) statically so the
    #     binary's only import is env.emscripten_notify_memory_growth
    #     (ALLOW_MEMORY_GROWTH). The loader calls `_initialize` when present.
    #   - `malloc`/`free` back the loader's scratch arena; the arena must sit
    #     above the shadow stack, which the loader checks against
    #     `emscripten_stack_get_base`.
    #
    # Two binaries from the same sources and flags, differing only in
    # -msimd128 (see STREETVIEW_WASM_TARGETS below):
    #   streetview-wasm.wasm       scalar — the main-thread loader, and the
    #                              worklet when SIMD128 does not validate
    #   streetview-wasm.simd.wasm  SIMD128 — the AudioWorklet's cabin DSP,
    #                              whose partitioned FIR is hand-vectorised
    #                              under __wasm_simd128__
    # Both must reproduce cpp/tests/goldens.json bit for bit.
    set(STREETVIEW_WASM_SOURCES
        src/noise_module.cpp
        src/geodesy_module.cpp
        src/audio_module.cpp
        src/hrtf_module.cpp
        src/luma_module.cpp
        src/cabin_dsp_module.cpp
        src/depth_module.cpp
        src/graph_module.cpp
        src/bindings.cpp
    )
    add_executable(streetview-wasm ${STREETVIEW_WASM_SOURCES})
    add_executable(streetview-wasm-simd ${STREETVIEW_WASM_SOURCES})
    set(STREETVIEW_WASM_TARGETS streetview-wasm streetview-wasm-simd)

    # Optimisation comes from CMAKE_BUILD_TYPE alone (Release: -O3 -DNDEBUG,
    # Debug: -g) — build-wasm.sh passes no CMAKE_CXX_FLAGS. The link step
    # needs its own level because it also drives wasm-opt.
    # Release adds -flto (compile + link): with -ffp-contract=off and no
    # -ffast-math, LTO may inline across the TUs but never re-associate or
    # fuse float ops, so the binaries reproduce the goldens bit for bit (CI's
    # `--compare` step and wasmGoldenParity.test.ts prove it on every build).
    # Debug keeps runtime assertions instead; it is never shipped.
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(STREETVIEW_WASM_LINK_OPT "-O0" "-g" "-s ASSERTIONS=1")
        set(STREETVIEW_WASM_LTO "")
    else()
        set(STREETVIEW_WASM_LINK_OPT "-O3" "-g0" "-flto" "-s ASSERTIONS=0")
        set(STREETVIEW_WASM_LTO -flto)
    endif()

    set(EMSCRIPTEN_FLAGS
        ${STREETVIEW_WASM_LINK_OPT}
        # STRICT: no deprecated settings or legacy defaults can creep in.
        "-s STRICT=1"
        "-s WASM=1"
        "-s STANDALONE_WASM=1"
        "--no-entry"
        # 16 MiB up front covers every per-frame buffer (noise tiles, the
        # quarter-res luma chore, a 256² depth map) without a first-frame grow.
        "-s INITIAL_MEMORY=16777216"
        "-s ALLOW_MEMORY_GROWTH=1"
        # The largest buffer the app hands the module is a snapshot's output
        # canvas (useAppCapture -> downsample_2d): CSS size x DPR (capped at 2),
        # 32 MiB at a 4K backing store, 59 MiB at 5K. The scratch arena rounds
        # to a power of two (src/wasm/marshal.ts), so 5K reserves 64 MiB on top
        # of the initial heap: 128 MiB is the explicit ceiling, never unbounded.
        "-s MAXIMUM_MEMORY=134217728"
        # 64 KiB of shadow stack, explicitly: the loader checks it
        # (emscripten_stack_get_base - emscripten_stack_get_end must equal
        # WASM_STACK_SIZE in src/wasm/marshal.ts) and puts the scratch arena above
        # it. #300's corruption was an assumption about exactly this number.
        "-s STACK_SIZE=65536"
        "-s EXPORTED_FUNCTIONS=['_seed','_noise2d','_fill_noise_buffer','_fbm2d','_fill_fbm_buffer','_fill_particle_seeds','_haversine','_batch_haversine','_offset_latlng','_normalize_angle','_signed_angle_diff','_initial_bearing','_polyline_resample','_polyline_project','_fill_engine_noise','_fill_cabin_ir','_fill_hrtf','_luma_histogram_bt709','_reduce_luma_bt709','_downsample_2d','_luma_analyze','_dsp_create','_dsp_destroy','_dsp_set_params','_dsp_set_ir','_dsp_render','_dsp_max_ir_taps','_depth_percentiles','_depth_near_depth','_depth_normalize','_graph_astar','_graph_nearest','_malloc','_free','_emscripten_stack_get_base','_emscripten_stack_get_end']"
        "-s EXPORTED_RUNTIME_METHODS=[]"
    )

    # Join list into a single string for linker flags.
    string(JOIN " " EMSCRIPTEN_LINK_FLAGS ${EMSCRIPTEN_FLAGS})

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
        set_target_properties(${target} PROPERTIES
            SUFFIX ".wasm"
            LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS}"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../public/wasm"
        )
    endforeach()

    # SIMD128 for the second binary. -msimd128 defines __wasm_simd128__, which
    # switches cabin_dsp_module.cpp's FIR to f32x4 intrinsics, and lets the
    # compiler autovectorize the rest. WASM SIMD128 has no FMA and we never pass
    # -ffast-math, so every result stays bit-identical to the scalar goldens.
    target_compile_options(streetview-wasm-simd PRIVATE -msimd128)
    # And at link time, so emcc runs wasm-opt with --enable-simd on this
    # target explicitly (it only infers features from the objects otherwise).
    target_link_options(streetview-wasm-simd PRIVATE -msimd128)
    set_target_properties(streetview-wasm-simd PROPERTIES OUTPUT_NAME "streetview-wasm.simd")
else()
    # -----------------------------------------------------------------------
    # Host target (system compiler — no Emscripten, no browser)
    # -----------------------------------------------------------------------
    # Same algorithms, compiled natively so `ctest` can assert them against the
    # golden vectors captured from the shipping WASM binary.
    # bindings.cpp is an empty TU on the host (#ifdef __EMSCRIPTEN__). Including
    # it here puts it in compile_commands.json so `clang-tidy -p cpp/build-host`
    # / `npm run lint:cpp` can see every algorithm source. Keep this list, the
    # emcc list above and scripts/lint-cpp.sh SOURCES in step when a TU is added.
    add_library(streetview_cpu STATIC
        src/noise_module.cpp
        src/geodesy_module.cpp
        src/audio_module.cpp
        src/hrtf_module.cpp
        src/luma_module.cpp
        src/cabin_dsp_module.cpp
        src/depth_module.cpp
        src/graph_module.cpp
        src/bindings.cpp
    )
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
