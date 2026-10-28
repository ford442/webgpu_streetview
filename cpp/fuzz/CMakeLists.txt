# cpp/fuzz — libFuzzer harnesses over the ABI (STREETVIEW_FUZZ=ON, clang only).
#
# Every source TU is compiled once more with coverage instrumentation plus
# ASan/UBSan, on the SIMDe path (SV_SIMDE) so the fuzzers exercise the SIMD
# code the binaries ship. scripts/fuzz-cpp.sh builds and runs them;
# nightly-probe.yml runs each for 60 s.

if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    message(FATAL_ERROR "STREETVIEW_FUZZ needs clang (libFuzzer)")
endif()

list(TRANSFORM STREETVIEW_SOURCES PREPEND "${PROJECT_SOURCE_DIR}/" OUTPUT_VARIABLE _sv_fuzz_sources)
set(_sv_fuzz_sanitizers -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)

add_library(streetview_fuzz_core STATIC ${_sv_fuzz_sources})
target_include_directories(streetview_fuzz_core PUBLIC "${PROJECT_SOURCE_DIR}/include")
target_include_directories(streetview_fuzz_core SYSTEM PUBLIC "${PROJECT_SOURCE_DIR}/third_party/simde")
target_compile_definitions(streetview_fuzz_core PUBLIC SV_SIMDE)
target_compile_options(streetview_fuzz_core PUBLIC ${STREETVIEW_FP_FLAGS} ${_sv_fuzz_sanitizers} -fsanitize=fuzzer-no-link)

set(STREETVIEW_FUZZ_TARGETS fuzz_luma fuzz_polyline fuzz_dsp fuzz_depth)
foreach(target IN LISTS STREETVIEW_FUZZ_TARGETS)
    add_executable(${target} ${target}.cpp)
    target_link_libraries(${target} PRIVATE streetview_fuzz_core)
    target_compile_options(${target} PRIVATE ${STREETVIEW_HOST_WARNINGS})
    target_link_options(${target} PRIVATE ${_sv_fuzz_sanitizers} -fsanitize=fuzzer)
endforeach()
