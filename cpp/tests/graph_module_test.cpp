/**
 * cpp/tests/graph_module_test.cpp
 *
 * Host tests for the link-graph kernels (cpp/src/graph_module.cpp): A* over
 * the CSR graph a trip prefetch saves, and the nearest-node lookup.
 *
 * The 200-node goldens are captured from the shipping scalar binary by
 * scripts/gen-wasm-goldens.mjs (the SIMD binary is checked against the same
 * vectors with `--compare`, the JS twin by wasmGoldenParity.test.ts). Paths are
 * integer node lists, so every backend must agree exactly — the tie-break on
 * the lower node index is what makes that hold.
 */

#include "doctest.h"

#include "streetview/abi.h"
#include "streetview/geodesy.h"
#include "goldens_generated.h"

#include <cmath>
#include <limits>
#include <string>
#include <vector>

namespace {

std::string at(int i) {
    return "case " + std::to_string(i);
}

struct Csr {
    std::vector<int> offsets;
    std::vector<int> neighbors;
    std::vector<double> coords;
    [[nodiscard]] int nodes() const { return static_cast<int>(offsets.size()) - 1; }
    [[nodiscard]] int edges() const { return static_cast<int>(neighbors.size()); }
};

Csr golden_graph() {
    Csr g;
    g.offsets.assign(std::begin(goldens::kGraphOffsets), std::end(goldens::kGraphOffsets));
    g.neighbors.assign(std::begin(goldens::kGraphNeighbors), std::end(goldens::kGraphNeighbors));
    g.coords.assign(std::begin(goldens::kGraphCoords), std::end(goldens::kGraphCoords));
    return g;
}

std::vector<double> work_for(int nodes) {
    return std::vector<double>(static_cast<size_t>(nodes) * SW_GRAPH_ASTAR_WORK_BYTES_PER_NODE /
                               sizeof(double));
}

std::vector<int> astar(const Csr& g, int from, int to, int* length_out = nullptr) {
    std::vector<double> work = work_for(g.nodes());
    std::vector<int> path(static_cast<size_t>(g.nodes()));
    const int len = sw_graph_astar(g.offsets.data(), g.neighbors.data(), g.coords.data(), g.nodes(),
                                   g.edges(), from, to, work.data(), path.data(), g.nodes());
    if (length_out != nullptr) *length_out = len;
    if (len <= 0) return {};
    path.resize(static_cast<size_t>(len));
    return path;
}

double edge_cost(const Csr& g, int a, int b) {
    const auto ia = static_cast<size_t>(a) * 2;
    const auto ib = static_cast<size_t>(b) * 2;
    return sw_haversine(g.coords[ia], g.coords[ia + 1], g.coords[ib], g.coords[ib + 1]);
}

double path_cost(const Csr& g, const std::vector<int>& path) {
    double total = 0.0;
    for (size_t i = 1; i < path.size(); ++i) total += edge_cost(g, path[i - 1], path[i]);
    return total;
}

/** O(n²) Dijkstra: the reference A* must agree with on cost. */
double dijkstra(const Csr& g, int from, int to) {
    const auto n = static_cast<size_t>(g.nodes());
    std::vector<double> dist(n, std::numeric_limits<double>::infinity());
    std::vector<bool> done(n, false);
    dist[static_cast<size_t>(from)] = 0.0;
    for (size_t iter = 0; iter < n; ++iter) {
        int u = -1;
        for (size_t i = 0; i < n; ++i) {
            if (!done[i] && (u < 0 || dist[i] < dist[static_cast<size_t>(u)]))
                u = static_cast<int>(i);
        }
        if (u < 0 || std::isinf(dist[static_cast<size_t>(u)])) break;
        done[static_cast<size_t>(u)] = true;
        for (int e = g.offsets[static_cast<size_t>(u)]; e < g.offsets[static_cast<size_t>(u) + 1];
             ++e) {
            const int v = g.neighbors[static_cast<size_t>(e)];
            const double d = dist[static_cast<size_t>(u)] + edge_cost(g, u, v);
            if (d < dist[static_cast<size_t>(v)]) dist[static_cast<size_t>(v)] = d;
        }
    }
    return dist[static_cast<size_t>(to)];
}

bool has_edge(const Csr& g, int a, int b) {
    for (int e = g.offsets[static_cast<size_t>(a)]; e < g.offsets[static_cast<size_t>(a) + 1];
         ++e) {
        if (g.neighbors[static_cast<size_t>(e)] == b) return true;
    }
    return false;
}

} // namespace

TEST_CASE("graph_astar matches the shipping WASM goldens") {
    const Csr g = golden_graph();
    REQUIRE(g.nodes() == goldens::kGraphNodeCount);
    REQUIRE(g.edges() == goldens::kGraphEdgeCount);
    int idx = 0;
    for (const auto& c : goldens::kGraphRoutes) {
        INFO(at(idx++));
        int len = 0;
        const std::vector<int> path = astar(g, c.from, c.to, &len);
        CHECK(len == c.length);
        for (int i = 0; i < c.length; ++i) {
            CHECK(path[static_cast<size_t>(i)] == c.path[i]);
        }
    }
}

TEST_CASE("graph_astar: golden paths are valid walks with the Dijkstra cost") {
    const Csr g = golden_graph();
    int idx = 0;
    for (const auto& c : goldens::kGraphRoutes) {
        INFO(at(idx++));
        const std::vector<int> path = astar(g, c.from, c.to);
        const double reference = dijkstra(g, c.from, c.to);
        if (std::isinf(reference)) {
            CHECK(path.empty());
            continue;
        }
        REQUIRE(!path.empty());
        CHECK(path.front() == c.from);
        CHECK(path.back() == c.to);
        for (size_t i = 1; i < path.size(); ++i) CHECK(has_edge(g, path[i - 1], path[i]));
        CHECK(std::fabs(path_cost(g, path) - reference) <= 1e-6);
    }
}

TEST_CASE("graph_astar: a one-way loop is routed around, not into") {
    // 0 → 1 → 2 → 3 heads straight at the goal 4 but 3 only loops back to 1;
    // the way to 4 starts by turning away, 0 → 5 → 4.
    Csr g;
    g.coords = {0.0, 0.0, 0.0, 0.001, 0.0005, 0.0015, -0.0005, 0.0015, 0.0, 0.003, 0.001, 0.0};
    g.offsets = {0, 2, 3, 4, 5, 5, 6};
    g.neighbors = {1, 5, 2, 3, 1, 4};
    int len = 0;
    const std::vector<int> path = astar(g, 0, 4, &len);
    CHECK(len == 3);
    CHECK(path == std::vector<int>{0, 5, 4});
    // And the reverse direction does not exist at all.
    CHECK(astar(g, 4, 0).empty());
}

TEST_CASE("graph_astar: snprintf-style sizing and a truncated buffer") {
    const Csr g = golden_graph();
    const auto& c = goldens::kGraphRoutes[0];
    std::vector<double> work = work_for(g.nodes());
    const int len = sw_graph_astar(g.offsets.data(), g.neighbors.data(), g.coords.data(), g.nodes(),
                                   g.edges(), c.from, c.to, work.data(), nullptr, 0);
    CHECK(len == c.length);
    std::vector<int> head(3, -7);
    CHECK(sw_graph_astar(g.offsets.data(), g.neighbors.data(), g.coords.data(), g.nodes(),
                         g.edges(), c.from, c.to, work.data(), head.data(), 3) == c.length);
    CHECK(head[0] == c.path[0]);
    CHECK(head[1] == c.path[1]);
    CHECK(head[2] == c.path[2]);
}

TEST_CASE("graph_astar: invalid input returns -1 and never reads out of bounds") {
    const Csr g = golden_graph();
    std::vector<double> work = work_for(g.nodes());
    std::vector<int> path(static_cast<size_t>(g.nodes()));
    const auto call = [&](const int* offsets, const int* neighbors, int nodes, int edges, int from,
                          int to) {
        return sw_graph_astar(offsets, neighbors, g.coords.data(), nodes, edges, from, to,
                              work.data(), path.data(), g.nodes());
    };
    CHECK(call(g.offsets.data(), g.neighbors.data(), g.nodes(), g.edges(), -1, 0) == -1);
    CHECK(call(g.offsets.data(), g.neighbors.data(), g.nodes(), g.edges(), 0, g.nodes()) == -1);
    CHECK(call(nullptr, g.neighbors.data(), g.nodes(), g.edges(), 0, 1) == -1);
    CHECK(call(g.offsets.data(), nullptr, g.nodes(), g.edges(), 0, 1) == -1);
    CHECK(call(g.offsets.data(), g.neighbors.data(), 0, g.edges(), 0, 0) == -1);
    // edge_count that disagrees with offsets[node_count].
    CHECK(call(g.offsets.data(), g.neighbors.data(), g.nodes(), g.edges() - 1, 0, 1) == -1);
    // Decreasing offsets.
    std::vector<int> bad = g.offsets;
    bad[5] = bad[6] + 1;
    CHECK(call(bad.data(), g.neighbors.data(), g.nodes(), g.edges(), 0, 1) == -1);
    // Out-of-range neighbour ids are skipped, not followed.
    const Csr tiny{{0, 2, 2}, {99, -3}, {0.0, 0.0, 0.0, 0.001}};
    std::vector<double> tiny_work = work_for(2);
    CHECK(sw_graph_astar(tiny.offsets.data(), tiny.neighbors.data(), tiny.coords.data(), 2, 2, 0, 1,
                         tiny_work.data(), nullptr, 0) == -1);
    CHECK(sw_graph_astar(tiny.offsets.data(), tiny.neighbors.data(), tiny.coords.data(), 2, 2, 1, 1,
                         tiny_work.data(), nullptr, 0) == 1);
    CHECK(sw_graph_astar(tiny.offsets.data(), tiny.neighbors.data(), tiny.coords.data(), 2, 2, 0, 1,
                         nullptr, nullptr, 0) == -1);
}

TEST_CASE("graph_nearest matches the shipping WASM goldens; empty graphs are -1") {
    int idx = 0;
    for (const auto& c : goldens::kGraphNearest) {
        INFO(at(idx++));
        CHECK(sw_graph_nearest(goldens::kGraphCoords, goldens::kGraphNodeCount, c.lat, c.lng) ==
              c.expected);
    }
    CHECK(sw_graph_nearest(goldens::kGraphCoords, 0, 0.0, 0.0) == -1);
    CHECK(sw_graph_nearest(nullptr, 4, 0.0, 0.0) == -1);
    // Ties go to the lower index.
    const double twins[4] = {1.0, 2.0, 1.0, 2.0};
    CHECK(sw_graph_nearest(twins, 2, 1.0, 2.0) == 0);
}
