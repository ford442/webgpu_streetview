# cpp/tests/CMakeLists.txt
#
# Native golden-vector tests for the C++ source of truth. Host-only: this
# directory is not added when configuring with emcmake (see ../CMakeLists.txt).
#
#   cmake -S cpp -B cpp/build-host
#   cmake --build cpp/build-host
#   ctest --test-dir cpp/build-host --output-on-failure

set(STREETVIEW_TEST_SOURCES
    noise_module_test.cpp
    cabin_dsp_test.cpp
    convolver_test.cpp
    depth_test.cpp
    graph_module_test.cpp
    runtime_test.cpp
)

# streetview_cpu_tests: the scalar paths. streetview_simd_tests: the same
# suite on the SIMD paths the wasm binaries ship (SV_SIMDE, see ../CMakeLists.txt).
# As wasm (STREETVIEW_WASM_TESTS) both would run the same -msimd128 code: one is enough.
set(STREETVIEW_TEST_PAIRS "streetview_cpu_tests:streetview_cpu")
if(NOT EMSCRIPTEN)
    list(APPEND STREETVIEW_TEST_PAIRS "streetview_simd_tests:streetview_cpu_simd")
endif()
foreach(pair IN LISTS STREETVIEW_TEST_PAIRS)
    string(REPLACE ":" ";" pair "${pair}")
    list(GET pair 0 exe)
    list(GET pair 1 lib)
    add_executable(${exe} ${STREETVIEW_TEST_SOURCES})
    target_link_libraries(${exe} PRIVATE ${lib})
    # goldens_generated.h lives next to this file.
    target_include_directories(${exe} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    # doctest is vendored and included as SYSTEM so our -Werror wall never
    # fires on third-party code.
    target_include_directories(${exe} SYSTEM PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/doctest)
    target_compile_options(${exe} PRIVATE ${STREETVIEW_HOST_WARNINGS})
    if(EMSCRIPTEN)
        # The repo's package.json is "type": "module"; emcc's node glue is CommonJS.
        set_target_properties(${exe} PROPERTIES SUFFIX ".cjs")
    endif()
    add_test(NAME ${exe} COMMAND ${exe})
endforeach()
