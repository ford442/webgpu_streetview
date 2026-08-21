# cpp/tests/CMakeLists.txt
#
# Native golden-vector tests for the C++ source of truth. Host-only: this
# directory is not added when configuring with emcmake (see ../CMakeLists.txt).
#
#   cmake -S cpp -B cpp/build-host
#   cmake --build cpp/build-host
#   ctest --test-dir cpp/build-host --output-on-failure

add_executable(streetview_cpu_tests noise_module_test.cpp)

target_link_libraries(streetview_cpu_tests PRIVATE streetview_cpu)

# goldens_generated.h lives next to this file.
target_include_directories(streetview_cpu_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# doctest is vendored and included as SYSTEM so our -Werror wall never fires on
# third-party code.
target_include_directories(streetview_cpu_tests SYSTEM PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/doctest)

target_compile_options(streetview_cpu_tests PRIVATE ${STREETVIEW_WARNINGS})

add_test(NAME streetview_cpu_tests COMMAND streetview_cpu_tests)
