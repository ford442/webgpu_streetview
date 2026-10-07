/**
 * src/services/maps/panoCoverageGraph.ts
 * Linked-pano coverage graph for the coverage map: a breadth-first walk over
 * `StreetViewPanoramaData.links` from the current panorama, a few hops out.
 *
 * Billing: every uncached node is one `getPanorama({ pano })`, metered as
 * `panorama` / `coverage-graph` on the session call meter. Nodes are cached for
 * the session (by pano id, metadata only — never imagery), so re-centring on a
 * pano already in the graph costs only the new frontier. The walk is opt-in
 * (the map's "Linked panos" toggle) and capped per walk and per session.
 */

import { getMapsCallBudget } from './callBudget';
import { haversineDistance } from '../../utils/navigation';

export interface PanoGraphNode {
  panoId: string;
  lat: number;
  lng: number;
  /** Linked pano ids, in the order Street View reported them. */
  links: string[];
  description?: string;
}

export interface PanoGraphEdge {
  from: string;
  to: string;
}

export interface PanoGraph {
  rootId: string;
  nodes: PanoGraphNode[];
  /** Undirected, deduplicated; only edges whose both ends are in `nodes`. */
  edges: PanoGraphEdge[];
  /** Lookups this walk made (cache hits excluded). */
  lookups: number;
  /** True when a cap (nodes, session lookups or the call meter) cut the walk short. */
  truncated: boolean;
}

/** Resolves one pano's metadata, or null when it can't (no data / budget refused). */
export type PanoNodeFetcher = (panoId: string) => Promise<PanoGraphNode | null>;

export const PANO_GRAPH_DEFAULTS = {
  maxHops: 3,
  maxNodes: 30,
  /** Session-wide cap on `coverage-graph` lookups, well under the 2000 panorama runaway guard. */
  maxSessionLookups: 240,
} as const;

const nodeCache = new Map<string, PanoGraphNode>();
let sessionLookups = 0;

/** Test-only: forget cached nodes and the session lookup count. */
export function resetPanoGraphCacheForTests(): void {
  nodeCache.clear();
  sessionLookups = 0;
}

export function getPanoGraphSessionLookups(): number {
  return sessionLookups;
}

export interface WalkPanoGraphOptions {
  maxHops?: number;
  maxNodes?: number;
  maxSessionLookups?: number;
}

export async function walkPanoGraph(
  rootId: string,
  fetchNode: PanoNodeFetcher,
  options: WalkPanoGraphOptions = {},
): Promise<PanoGraph> {
  const maxHops = options.maxHops ?? PANO_GRAPH_DEFAULTS.maxHops;
  const maxNodes = options.maxNodes ?? PANO_GRAPH_DEFAULTS.maxNodes;
  const maxSessionLookups = options.maxSessionLookups ?? PANO_GRAPH_DEFAULTS.maxSessionLookups;

  const found = new Map<string, PanoGraphNode>();
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  let lookups = 0;
  let truncated = false;

  const resolve = async (panoId: string): Promise<PanoGraphNode | null> => {
    const cached = nodeCache.get(panoId);
    if (cached) return cached;
    if (sessionLookups >= maxSessionLookups) {
      truncated = true;
      return null;
    }
    sessionLookups += 1;
    lookups += 1;
    const node = await fetchNode(panoId);
    if (node) nodeCache.set(panoId, node);
    return node;
  };

  for (let hop = 0; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    // Sequential on purpose: a cap hit stops the walk without a burst of in-flight calls.
    for (const panoId of frontier) {
      if (found.size >= maxNodes) {
        truncated = true;
        break;
      }
      const node = await resolve(panoId);
      if (!node) continue;
      found.set(panoId, node);
      if (hop === maxHops) continue;
      for (const link of node.links) {
        if (visited.has(link)) continue;
        visited.add(link);
        next.push(link);
      }
    }
    if (found.size >= maxNodes) {
      if (next.length > 0) truncated = true;
      break;
    }
    frontier = next;
  }

  return { rootId, nodes: [...found.values()], edges: graphEdges(found), lookups, truncated };
}

function graphEdges(nodes: Map<string, PanoGraphNode>): PanoGraphEdge[] {
  const edges: PanoGraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes.values()) {
    for (const link of node.links) {
      if (!nodes.has(link)) continue;
      const key = node.panoId < link ? `${node.panoId}|${link}` : `${link}|${node.panoId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: node.panoId, to: link });
    }
  }
  return edges;
}

/** Closest graph node within `radiusM` metres, or null. */
export function nearestGraphNode(
  nodes: readonly PanoGraphNode[],
  lat: number,
  lng: number,
  radiusM: number,
): PanoGraphNode | null {
  let best: PanoGraphNode | null = null;
  let bestM = radiusM;
  for (const node of nodes) {
    const m = haversineDistance(lat, lng, node.lat, node.lng) * 1000;
    if (m <= bestM) {
      best = node;
      bestM = m;
    }
  }
  return best;
}

/** Map `getPanorama` data onto a graph node; null when it carries no location. */
export function panoNodeFromData(data: google.maps.StreetViewPanoramaData | null): PanoGraphNode | null {
  const loc = data?.location;
  const latLng = loc?.latLng;
  if (!loc?.pano || !latLng) return null;
  return {
    panoId: loc.pano,
    lat: latLng.lat(),
    lng: latLng.lng(),
    links: (data?.links ?? []).map((l) => l?.pano).filter((p): p is string => typeof p === 'string' && p.length > 0),
    description: loc.description ?? undefined,
  };
}

/** Production fetcher: one metered `getPanorama({ pano })` per uncached node. */
export function createMeteredPanoFetcher(svc: google.maps.StreetViewService): PanoNodeFetcher {
  return (panoId) => {
    if (!getMapsCallBudget().tryConsume('panorama', 'coverage-graph')) return Promise.resolve(null);
    return new Promise((resolve) => {
      svc.getPanorama({ pano: panoId }, (data, status) => {
        resolve(status === google.maps.StreetViewStatus.OK ? panoNodeFromData(data) : null);
      });
    });
  };
}
