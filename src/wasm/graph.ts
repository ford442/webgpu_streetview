/**
 * src/wasm/graph.ts
 * Marshals a prefetched link graph (`RouteGraphNode[]`, see
 * `offline/routePrefetch.ts`) into the CSR arrays `graph_astar` /
 * `graph_nearest` read (cpp/src/graph_module.cpp), once per graph.
 *
 * Node order is the panoId sort order, so the same graph always produces the
 * same CSR — and therefore the same path — however IndexedDB returned it.
 * Links to panos that are not in the graph (a side street the prefetch never
 * visited) are dropped: the kernel only walks what is cached.
 */

import type { RouteGraphNode } from '../offline/offlineStore';
import type { CsrGraph } from './abi';
import { requireWasm } from './index';

export interface LinkGraph {
  csr: CsrGraph;
  /** CSR node index → pano id. */
  panoIds: readonly string[];
  /** Pano id → CSR node index. */
  indexOf: ReadonlyMap<string, number>;
  nodes: readonly RouteGraphNode[];
}

export function buildLinkGraph(nodes: readonly RouteGraphNode[]): LinkGraph {
  const byId = new Map<string, RouteGraphNode>();
  for (const node of nodes) byId.set(node.panoId, node);
  const panoIds = Array.from(byId.keys()).sort();
  const indexOf = new Map(panoIds.map((id, i) => [id, i]));
  const n = panoIds.length;

  const offsets = new Int32Array(n + 1);
  const coords = new Float64Array(n * 2);
  const neighbors: number[] = [];
  const ordered: RouteGraphNode[] = [];
  panoIds.forEach((id, i) => {
    const node = byId.get(id)!;
    ordered.push(node);
    coords[i * 2] = node.lat;
    coords[i * 2 + 1] = node.lng;
    const seen = new Set<number>();
    for (const link of node.linkPanoIds) {
      const j = indexOf.get(link);
      if (j === undefined || j === i || seen.has(j)) continue;
      seen.add(j);
      neighbors.push(j);
    }
    offsets[i + 1] = neighbors.length;
  });

  return {
    csr: { nodeCount: n, offsets, neighbors: Int32Array.from(neighbors), coords },
    panoIds,
    indexOf,
    nodes: ordered,
  };
}

const cache = new Map<string, { source: readonly RouteGraphNode[]; graph: LinkGraph }>();

/**
 * The CSR form of `nodes`, built once per `routeId`. A different `nodes`
 * array for the same route (a re-prefetch) rebuilds it.
 */
export function linkGraphFor(routeId: string, nodes: readonly RouteGraphNode[]): LinkGraph {
  const hit = cache.get(routeId);
  if (hit && hit.source === nodes) return hit.graph;
  const graph = buildLinkGraph(nodes);
  cache.set(routeId, { source: nodes, graph });
  return graph;
}

/** Shortest path between two panos as pano ids (`from` first), or null. */
export function shortestPanoPath(graph: LinkGraph, fromPanoId: string, toPanoId: string): string[] | null {
  const from = graph.indexOf.get(fromPanoId);
  const to = graph.indexOf.get(toPanoId);
  if (from === undefined || to === undefined) return null;
  const path = requireWasm().graphAstar(graph.csr, from, to);
  return path ? Array.from(path, (i) => graph.panoIds[i]!) : null;
}

/** The graph pano nearest to a coordinate, or null for an empty graph. */
export function nearestPano(graph: LinkGraph, lat: number, lng: number): string | null {
  const i = requireWasm().graphNearest(graph.csr, lat, lng);
  return i >= 0 ? graph.panoIds[i]! : null;
}
