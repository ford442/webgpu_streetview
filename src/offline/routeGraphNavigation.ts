/**
 * Pure, offline-friendly navigation helpers over a prefetched `RouteGraphNode[]`
 * graph (see `routePrefetch.ts` / `offlineStore.ts`). No network access here —
 * these only ever consult data already persisted by a prior prefetch.
 */

import { absoluteAngleDiff, initialBearing } from '../utils/navigation';
import { nearestPano, shortestPanoPath, type LinkGraph } from '../wasm/graph';
import type { RouteGraphNode } from './offlineStore';

const MAX_HEADING_DIFF_DEG = 45;

/**
 * Pick the neighbor of `currentPanoId` (via its stored `linkPanoIds`) whose
 * bearing is closest to `targetHeading`, mirroring the live `findBestLink`
 * heuristic in `utils/navigation.ts` but using cached graph data instead of
 * a live `getLinks()` call. Returns null if the current pano isn't in the
 * graph or no neighbor is within `MAX_HEADING_DIFF_DEG`.
 */
export function findBestOfflineLink(
  nodes: readonly RouteGraphNode[],
  currentPanoId: string,
  targetHeading: number,
): RouteGraphNode | null {
  const byId = new Map(nodes.map((node) => [node.panoId, node]));
  const current = byId.get(currentPanoId);
  if (!current) return null;

  let best: RouteGraphNode | null = null;
  let smallestDiff = MAX_HEADING_DIFF_DEG;

  for (const linkedId of current.linkPanoIds) {
    const linked = byId.get(linkedId);
    if (!linked) continue;
    const bearing = initialBearing(current.lat, current.lng, linked.lat, linked.lng);
    const diff = absoluteAngleDiff(targetHeading, bearing);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      best = linked;
    }
  }

  return best;
}

/**
 * Breadth-first search over the prefetched link graph from `fromPanoId` to
 * `toPanoId`. Returns the ordered list of intermediate + destination nodes
 * (excluding the start), or null if no path is found within `maxHops`.
 * Used to pre-warm the panorama cache for hops a recorded tour "knows about"
 * via its offline graph, without changing where playback actually teleports.
 */
export function findPathBetweenPanos(
  nodes: RouteGraphNode[],
  fromPanoId: string,
  toPanoId: string,
  maxHops = 8,
): RouteGraphNode[] | null {
  if (fromPanoId === toPanoId) return [];

  const byId = new Map(nodes.map((node) => [node.panoId, node]));
  if (!byId.has(fromPanoId) || !byId.has(toPanoId)) return null;

  const visited = new Set<string>([fromPanoId]);
  const queue: { panoId: string; path: RouteGraphNode[] }[] = [{ panoId: fromPanoId, path: [] }];

  while (queue.length > 0) {
    const { panoId, path } = queue.shift()!;
    if (path.length >= maxHops) continue;
    const node = byId.get(panoId);
    if (!node) continue;

    for (const nextId of node.linkPanoIds) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const nextNode = byId.get(nextId);
      if (!nextNode) continue;

      const nextPath = [...path, nextNode];
      if (nextId === toPanoId) return nextPath;
      queue.push({ panoId: nextId, path: nextPath });
    }
  }

  return null;
}

export type OfflineHopPlan =
  /** Next pano on the kernel's shortest path to the destination. */
  | { kind: 'astar'; next: RouteGraphNode; remainingHops: number }
  /**
   * The kernel found no path (the cached graph has a gap); this is the greedy
   * bearing walk's pick instead. Callers report it — it can dead-end.
   */
  | { kind: 'greedy'; next: RouteGraphNode }
  /** Already at the graph pano nearest the destination. */
  | { kind: 'arrived' };

/**
 * Where to hop next when driving a prefetched graph without the network:
 * the next pano on the shortest path (`graph_astar`) from `currentPanoId` to
 * the graph pano nearest `destination`. When the graph has no path, falls
 * back to {@link findBestOfflineLink} aimed at the destination and says so
 * (`kind: 'greedy'`). Null when the current pano is not in the graph or the
 * greedy walk has nowhere to go either.
 */
export function planOfflineHop(
  graph: LinkGraph,
  currentPanoId: string,
  destination: { lat: number; lng: number },
): OfflineHopPlan | null {
  const current = graph.indexOf.get(currentPanoId);
  if (current === undefined) return null;
  const goal = nearestPano(graph, destination.lat, destination.lng);
  if (goal === null) return null;
  if (goal === currentPanoId) return { kind: 'arrived' };

  const path = shortestPanoPath(graph, currentPanoId, goal);
  if (path && path.length >= 2) {
    const next = graph.nodes[graph.indexOf.get(path[1]!)!]!;
    return { kind: 'astar', next, remainingHops: path.length - 1 };
  }

  const here = graph.nodes[current]!;
  const heading = initialBearing(here.lat, here.lng, destination.lat, destination.lng);
  const greedy = findBestOfflineLink(graph.nodes, currentPanoId, heading);
  return greedy ? { kind: 'greedy', next: greedy } : null;
}
