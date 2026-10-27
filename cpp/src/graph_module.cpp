/**
 * graph_module.cpp
 * Shortest paths over the prefetched Street View link graph.
 *
 * A trip saved for offline (src/offline/routePrefetch.ts) is a set of panos
 * and the pano ids each one links to. src/wasm/graph.ts flattens it into CSR
 * — `offsets` (node_count + 1 ints), `neighbors` (edge_count ints, directed:
 * a link the Maps API only reports one way is one edge) and `coords`
 * (node_count [lat, lng] pairs) — and these kernels walk it:
 *
 *   graph_astar    A* from one node to another, edge cost and heuristic both
 *                  the haversine of geodesy_module.cpp (admissible on a
 *                  sphere, so the path is the shortest one).
 *   graph_nearest  the node closest to a coordinate.
 *
 * Every buffer, including the open set, belongs to the caller (the loader's
 * scratch arena, src/wasm/marshal.ts): nothing here allocates, throws or keeps
 * state. Ties break on the lower node index everywhere, so a path is a pure
 * function of the CSR arrays and the goldens are stable on every backend.
 *
 * Build with Emscripten (see CMakeLists.txt or scripts/build-wasm.sh).
 */

#include "streetview_wasm.h"
#include <cstddef>
#include <limits>
#include <span>

namespace {

/** heap_pos value of a node that has never been reached. */
constexpr int kUnseen = -1;
/** heap_pos value of a node whose shortest distance is final. */
constexpr int kClosed = -2;

size_t idx(int i) { return static_cast<size_t>(i); }

/**
 * Binary min-heap of node indices keyed on f = g + h, with decrease-key
 * through `pos` (each node's slot in `heap`, or kUnseen / kClosed).
 */
struct OpenSet {
    std::span<const double> f;
    std::span<int> heap;
    std::span<int> pos;
    int size = 0;

    /** Strict weak order: lower f first, then the lower node index. */
    [[nodiscard]] bool before(int a, int b) const {
        const double fa = f[idx(a)];
        const double fb = f[idx(b)];
        return fa < fb || (fa == fb && a < b);
    }

    void place(int slot, int node) {
        heap[idx(slot)] = node;
        pos[idx(node)] = slot;
    }

    void sift_up(int slot) {
        const int node = heap[idx(slot)];
        while (slot > 0) {
            const int parent = (slot - 1) / 2;
            if (!before(node, heap[idx(parent)])) break;
            place(slot, heap[idx(parent)]);
            slot = parent;
        }
        place(slot, node);
    }

    void sift_down(int slot) {
        const int node = heap[idx(slot)];
        for (;;) {
            const int left = slot * 2 + 1;
            if (left >= size) break;
            const int right = left + 1;
            int child = left;
            if (right < size && before(heap[idx(right)], heap[idx(left)])) child = right;
            if (!before(heap[idx(child)], node)) break;
            place(slot, heap[idx(child)]);
            slot = child;
        }
        place(slot, node);
    }

    void push(int node) {
        heap[idx(size)] = node;
        pos[idx(node)] = size;
        ++size;
        sift_up(size - 1);
    }

    int pop() {
        const int top = heap[0];
        --size;
        if (size > 0) {
            heap[0] = heap[idx(size)];
            pos[idx(heap[0])] = 0;
            sift_down(0);
        }
        pos[idx(top)] = kClosed;
        return top;
    }
};

double node_distance(std::span<const double> coords, int a, int b) {
    return sw_haversine(coords[idx(a) * 2], coords[idx(a) * 2 + 1],
                        coords[idx(b) * 2], coords[idx(b) * 2 + 1]);
}

/** offsets must start at 0, never decrease and end at edge_count. */
bool valid_offsets(std::span<const int> offsets, int edge_count) {
    if (offsets[0] != 0 || offsets[offsets.size() - 1] != edge_count) return false;
    for (size_t i = 1; i < offsets.size(); ++i) {
        if (offsets[i] < offsets[i - 1]) return false;
    }
    return true;
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
extern "C" {

int sw_graph_astar(const int* offsets, const int* neighbors, const double* coords,
                   int node_count, int edge_count, int from, int to,
                   void* work, int* out_path, int max_len) {
    if (offsets == nullptr || coords == nullptr || work == nullptr) return -1;
    if (node_count <= 0 || edge_count < 0 || (edge_count > 0 && neighbors == nullptr)) return -1;
    if (from < 0 || from >= node_count || to < 0 || to >= node_count) return -1;

    const size_t n = idx(node_count);
    const std::span<const int> offs(offsets, n + 1);
    if (!valid_offsets(offs, edge_count)) return -1;
    const std::span<const int> nbrs(neighbors, idx(edge_count));
    const std::span<const double> xy(coords, n * 2);

    // Work layout (SW_GRAPH_ASTAR_WORK_BYTES_PER_NODE per node): the doubles
    // first so they stay 8-byte aligned, then the int arrays.
    auto* doubles = static_cast<double*>(work);
    const std::span<double> g(doubles, n);
    const std::span<double> f(doubles + n, n);
    auto* ints = reinterpret_cast<int*>(doubles + n * 2); // NOLINT(cppcoreguidelines-pro-type-reinterpret-cast)
    const std::span<int> parent(ints, n);
    const std::span<int> pos(ints + n, n);
    const std::span<int> heap(ints + n * 2, n);

    for (size_t i = 0; i < n; ++i) {
        g[i] = std::numeric_limits<double>::infinity();
        f[i] = std::numeric_limits<double>::infinity();
        parent[i] = -1;
        pos[i] = kUnseen;
    }

    OpenSet open{ f, heap, pos };
    g[idx(from)] = 0.0;
    f[idx(from)] = node_distance(xy, from, to);
    open.push(from);

    bool found = false;
    while (open.size > 0) {
        const int node = open.pop();
        if (node == to) {
            found = true;
            break;
        }
        for (int e = offs[idx(node)]; e < offs[idx(node) + 1]; ++e) {
            const int next = nbrs[idx(e)];
            if (next < 0 || next >= node_count || pos[idx(next)] == kClosed) continue;
            const double tentative = g[idx(node)] + node_distance(xy, node, next);
            // Strict < : the first relaxation of an equal-cost route wins.
            if (!(tentative < g[idx(next)])) continue;
            g[idx(next)] = tentative;
            f[idx(next)] = tentative + node_distance(xy, next, to);
            parent[idx(next)] = node;
            if (pos[idx(next)] == kUnseen) {
                open.push(next);
            } else {
                open.sift_up(pos[idx(next)]);
            }
        }
    }
    if (!found) return -1;

    int length = 1;
    for (int at = to; at != from; at = parent[idx(at)]) ++length;

    if (out_path != nullptr && max_len > 0) {
        const std::span<int> path(out_path, idx(max_len));
        int at = to;
        for (int i = length - 1; i >= 0; --i) {
            if (i < max_len) path[idx(i)] = at;
            if (i > 0) at = parent[idx(at)];
        }
    }
    return length;
}

int sw_graph_nearest(const double* coords, int node_count, double lat, double lng) {
    if (coords == nullptr || node_count <= 0) return -1;
    const std::span<const double> xy(coords, idx(node_count) * 2);
    int best = -1;
    double best_dist = std::numeric_limits<double>::infinity();
    for (int i = 0; i < node_count; ++i) {
        const double d = sw_haversine(xy[idx(i) * 2], xy[idx(i) * 2 + 1], lat, lng);
        // Strict < : on a tie the lower index wins, on every backend.
        if (d < best_dist) {
            best_dist = d;
            best = i;
        }
    }
    return best;
}

} // extern "C"
