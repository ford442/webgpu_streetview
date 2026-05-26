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
if(EMSCRIPTEN)
    set(EMSCRIPTEN_FLAGS
        "-O3"
        "-s WASM=1"
        "-s MODULARIZE=1"
        "-s EXPORT_ES6=1"
        "-s EXPORT_NAME=StreetViewWasm"
        "-s ALLOW_MEMORY_GROWTH=1"
        "-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPF32','HEAPU8']"
        "-s EXPORTED_FUNCTIONS=['_sw_seed','_sw_noise2d','_sw_fill_noise_buffer','_sw_haversine','_sw_normalize_angle','_sw_signed_angle_diff','_malloc','_free']"
        "--bind"
        "-s ENVIRONMENT=web,worker"
    )

    # Join list into a single string for linker flags.
    string(JOIN " " EMSCRIPTEN_LINK_FLAGS ${EMSCRIPTEN_FLAGS})

    set_target_properties(streetview-wasm PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../public/wasm"
    )

    target_compile_options(streetview-wasm PRIVATE -O3)
endif()
