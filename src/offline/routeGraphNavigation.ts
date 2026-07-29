/**
 * Pure, offline-friendly navigation helpers over a prefetched `RouteGraphNode[]`
 * graph (see `routePrefetch.ts` / `offlineStore.ts`). No network access here —
 * these only ever consult data already persisted by a prior prefetch.
 */

import { absoluteAngleDiff, initialBearing } from '../utils/navigation';
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
  nodes: RouteGraphNode[],
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
