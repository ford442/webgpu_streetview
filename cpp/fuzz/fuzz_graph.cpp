/**
 * cpp/fuzz/fuzz_graph.cpp — graph_astar / graph_nearest on random CSR graphs:
 * offsets that are non-monotonic or end short, out-of-range neighbour
 * indices, raw f64 coordinates (NaN, inf, poles), from/to out of range and
 * output buffers shorter than the path.
 */
#include "fuzz_input.h"
#include "streetview/abi.h"

#include <cmath>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    sv_fuzz::Input in(data, size);
    const int nodes = in.range(-1, 24);
    const int edges = in.range(-1, 64);
    const int from = in.range(-2, 26);
    const int to = in.range(-2, 26);
    const int max_len = in.range(-1, 30);
    const size_t n = nodes > 0 ? static_cast<size_t>(nodes) : 0;
    const size_t e = edges > 0 ? static_cast<size_t>(edges) : 0;

    std::vector<int> offsets = in.many<int>(n + 1);
    // Half the inputs get a well-formed offsets array so the search itself runs.
    if (in.take<uint8_t>() & 1U) {
        size_t at = 0;
        for (size_t i = 0; i <= n; ++i) {
            offsets[i] = static_cast<int>(at);
            if (at < e) at += static_cast<size_t>(in.take<uint8_t>() % 4U);
            if (at > e) at = e;
        }
        offsets[n] = edges > 0 ? edges : 0;
    }
    std::vector<int> neighbors = in.many<int>(e);
    if (in.take<uint8_t>() & 1U) {
        for (int& v : neighbors) v = static_cast<int>(static_cast<uint32_t>(v) % (n + 2U));
    }
    std::vector<double> coords = in.many<double>(n * 2);
    // work: node_count * 32 bytes, 8-byte aligned (doubles).
    std::vector<double> work(n * 4 + 1);
    std::vector<int> path(max_len > 0 ? static_cast<size_t>(max_len) : 0);

    const int count = sw_graph_astar(offsets.data(), edges == 0 ? nullptr : neighbors.data(),
                                     coords.data(), nodes, edges, from, to, work.data(),
                                     max_len > 0 ? path.data() : nullptr, max_len);
    sv_fuzz::require(count >= -1);
    if (count > 0 && max_len > 0) {
        // First and last written node are `from` / `to` (when the whole path fit).
        sv_fuzz::require(path[0] == from);
        if (count <= max_len) sv_fuzz::require(path[static_cast<size_t>(count) - 1] == to);
    }

    const int nearest =
        sw_graph_nearest(coords.data(), nodes, in.take<double>(), in.take<double>());
    sv_fuzz::require(nearest >= -1 && nearest < (nodes > 0 ? nodes : 0));
    return 0;
}
