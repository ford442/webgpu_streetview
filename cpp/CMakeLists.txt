cmake_minimum_required(VERSION 3.16)
project(streetview_wasm CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
set(SOURCES
    src/noise_module.cpp
    src/bindings.cpp
)

add_executable(streetview-wasm ${SOURCES})

target_include_directories(streetview-wasm PRIVATE include)

# ---------------------------------------------------------------------------
# Emscripten-specific flags
# ---------------------------------------------------------------------------
# The output WASM must be ABI-compatible with the WAT module and the
# TypeScript loader in src/wasm/index.ts.  Key requirements:
#
#   - No MODULARIZE / EXPORT_ES6 / JS glue wrapper — the TS loader
#     instantiates the .wasm binary directly via WebAssembly.instantiate().
#   - No embind (--bind) — raw C exports are used instead.
#   - Exported function names match the WAT module exactly:
#       seed, noise2d, fill_noise_buffer, haversine,
#       normalize_angle, signed_angle_diff
#     These are thin wrappers (in bindings.cpp) around the sw_* functions
#     in noise_module.cpp.
#   - STANDALONE_WASM=1 links math (sin/cos/atan2) statically so the
#     binary has no host math imports, matching the fact that the WAT
#     module uses env.sin/cos/atan2 but the Emscripten binary does not.
#     The TS loader's importObject supplies those env stubs regardless;
#     extra keys in the import object are silently ignored by the runtime.
if(EMSCRIPTEN)
    set(EMSCRIPTEN_FLAGS
        "-O3"
        "-s WASM=1"
        "-s STANDALONE_WASM=1"
        "--no-entry"
        "-s ALLOW_MEMORY_GROWTH=1"
        "-s EXPORTED_FUNCTIONS=['_seed','_noise2d','_fill_noise_buffer','_haversine','_normalize_angle','_signed_angle_diff','_malloc','_free']"
        "-s EXPORTED_RUNTIME_METHODS=[]"
    )

    # Join list into a single string for linker flags.
    string(JOIN " " EMSCRIPTEN_LINK_FLAGS ${EMSCRIPTEN_FLAGS})

    set_target_properties(streetview-wasm PROPERTIES
        SUFFIX ".wasm"
        LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../public/wasm"
    )

    target_compile_options(streetview-wasm PRIVATE -O3)
endif()
