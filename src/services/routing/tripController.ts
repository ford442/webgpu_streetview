/**
 * src/services/routing/tripController.ts
 * Plans a trip, drives it, ends it — the glue between the route provider, the
 * route follower and `tripStore`. React-free so cruise can read the active
 * guide through a stable function (`getActiveRouteGuide`) and tests can drive
 * a whole trip without rendering the shell.
 *
 * The app-side effects (the one metered re-snap, easing the car body, the
 * announcer) are injected by `app/useTripBindings.ts` via
 * {@link configureTripController}.
 */

import type { CruiseRouteGuide } from '../../hooks/useCruiseMode';
import type { RouteGraphNode } from '../../offline/offlineStore';
import { planOfflineHop } from '../../offline/routeGraphNavigation';
import { tripStore, type OfflineDriveStats, type TripStop, type TripSummary } from '../../state/tripStore';
import { linkGraphFor, type LinkGraph } from '../../wasm/graph';
import { getMapsCallBudget } from '../maps/callBudget';
import { RouteFollower, type LinkLike, type RouteFollowConfig, type RouteHopDecision } from './routeFollow';
import { bearingBetween, buildActiveRoute, type ActiveRoute } from './routeGeometry';
import {
  RouteError,
  describeRouteError,
  isValidLatLng,
  type LatLng,
  type RouteProvider,
} from './RouteProvider';

export interface TripControllerDeps {
  /** One metered `getPanorama` + hold-pause teleport; true when the pano moved. */
  resnapTo(target: LatLng): Promise<boolean>;
  /** Car body eases toward the route (car mode only — the binding decides). */
  easeCarHeading?(bearingDeg: number): void;
  onArrived?(summary: TripSummary): void;
  now?(): number;
  followConfig?: Partial<RouteFollowConfig>;
  /**
   * True when hops should come from the cached link graph (`navigator.onLine`
   * false, or `?offline=1`). The hop itself is still `setPano` via cruise.
   */
  isOffline?(): boolean;
}

let deps: TripControllerDeps | null = null;
let follower: RouteFollower | null = null;
let lastHopWasResnap = false;
let planAbort: AbortController | null = null;
let offlineGraph: { routeId: string; graph: LinkGraph } | null = null;

export function configureTripController(next: TripControllerDeps | null): void {
  deps = next;
}

/**
 * The prefetched link graph for `routeId` ("Save for offline"), or null to
 * drop it. Marshalled to CSR once (`wasm/graph.ts`, cached by route id).
 */
export function setTripOfflineGraph(routeId: string, nodes: readonly RouteGraphNode[] | null): void {
  offlineGraph = nodes && nodes.length > 0 ? { routeId, graph: linkGraphFor(routeId, nodes) } : null;
}

/** Whether a cached graph covers `routeId` (and how many panos it holds). */
export function tripOfflineGraphSize(routeId: string): number {
  return offlineGraph?.routeId === routeId ? offlineGraph.graph.panoIds.length : 0;
}

/** A pano of the cached graph (its capture date seeds a trip recording), if loaded. */
export function tripOfflineGraphNode(panoId: string): RouteGraphNode | null {
  const i = offlineGraph?.graph.indexOf.get(panoId);
  return i === undefined ? null : offlineGraph!.graph.nodes[i]!;
}

const NO_OFFLINE_HOPS: OfflineDriveStats = { astarHops: 0, greedyHops: 0, offGraphHops: 0 };

function countOfflineHop(key: keyof OfflineDriveStats): void {
  tripStore.update((s) => {
    const prev = s.offlineDrive ?? NO_OFFLINE_HOPS;
    return { offlineDrive: { ...prev, [key]: prev[key] + 1 } };
  });
}

/**
 * The graph planner's hop, or null to let the live follower decide (no graph
 * for this route, or the pano is not in it). A greedy fallback is counted and
 * logged, never silent.
 */
function planGraphHop(
  active: RouteFollower,
  panoId: string,
  position: LatLng,
  links: readonly LinkLike[],
): RouteHopDecision | null {
  if (!offlineGraph || offlineGraph.routeId !== active.route.id) return null;
  if (active.hasArrived(position)) return { kind: 'arrived' };
  const { graph } = offlineGraph;
  const destination = active.route.polyline[active.route.polyline.length - 1]!;
  const plan = planOfflineHop(graph, panoId, destination);
  if (!plan) {
    countOfflineHop('offGraphHops');
    return null;
  }
  if (plan.kind === 'arrived') return { kind: 'arrived' };
  if (plan.kind === 'greedy') {
    console.warn(`[trip] Offline graph has no path from ${panoId}; greedy link walk chose ${plan.next.panoId}`);
  }
  countOfflineHop(plan.kind === 'astar' ? 'astarHops' : 'greedyHops');

  const here = graph.nodes[graph.indexOf.get(panoId)!]!;
  const k = here.linkPanoIds.indexOf(plan.next.panoId);
  const stored = k >= 0 ? here.linkHeadings?.[k] : undefined;
  const heading = links.find((l) => l.pano === plan.next.panoId)?.heading
    ?? (stored !== undefined && Number.isFinite(stored) ? stored : bearingBetween(here, plan.next));
  return { kind: 'follow', heading, targetBearing: heading, panoId: plan.next.panoId, planner: plan.kind };
}

const now = (): number => deps?.now?.() ?? Date.now();

/**
 * Ask the provider for a route through `stops`. On success the trip is
 * `ready`; on any failure it is `error` with an honest message and no route.
 * A newer plan cancels an older one still in flight.
 */
export async function planTrip(stops: readonly TripStop[], provider: RouteProvider): Promise<ActiveRoute | null> {
  planAbort?.abort();
  const controller = new AbortController();
  planAbort = controller;
  follower = null;

  if (stops.length < 2 || !stops.every(isValidLatLng)) {
    tripStore.reset({ status: 'error', stops, error: 'Pick a destination with a valid location.' });
    return null;
  }
  const meterKind = provider.billable ? 'directions' : 'routing';
  if (!getMapsCallBudget().tryConsume(meterKind, `route:${provider.id}`)) {
    tripStore.reset({ status: 'error', stops, error: describeRouteError(new RouteError('budget', 'budget')) });
    return null;
  }

  tripStore.reset({ status: 'planning', stops });
  try {
    const route = await provider.route(
      { waypoints: stops.map(({ lat, lng }) => ({ lat, lng })), profile: 'driving' },
      controller.signal,
    );
    if (controller.signal.aborted) return null;
    const active = buildActiveRoute(route, { stops: stops.map(({ lat, lng }) => ({ lat, lng })), providerId: provider.id });
    tripStore.reset({ status: 'ready', stops, route: active });
    return active;
  } catch (err) {
    if (controller.signal.aborted) return null;
    tripStore.reset({ status: 'error', stops, error: describeRouteError(err) });
    return null;
  } finally {
    if (planAbort === controller) planAbort = null;
  }
}

/** Start following the planned route from `position` (the current pano). */
export function startDrive(position: LatLng | null): boolean {
  const { route, status } = tripStore.get();
  if (!route || (status !== 'ready' && status !== 'arrived' && status !== 'driving')) return false;
  // Resuming a drive in progress (cruise was toggled off) keeps its progress and stats.
  if (status === 'driving' && follower?.route === route) return true;
  follower = new RouteFollower(route, deps?.followConfig, now);
  lastHopWasResnap = false;
  const progress = position ? follower.notePosition(position) : null;
  tripStore.update({ status: 'driving', progress, resnaps: 0, startedAt: now(), summary: null, offlineDrive: null });
  return true;
}

/** Leave the route planned but stop following it (cruise off, or manual stop). */
export function pauseDrive(): void {
  if (tripStore.get().status === 'driving') tripStore.update({ status: 'ready' });
}

export function clearTrip(): void {
  planAbort?.abort();
  planAbort = null;
  follower = null;
  tripStore.reset();
}

function finish(): void {
  const s = tripStore.get();
  const elapsedS = s.startedAt !== null ? Math.max(0, (now() - s.startedAt) / 1000) : 0;
  const summary: TripSummary = {
    distanceM: s.progress?.alongM ?? s.route?.lengthM ?? 0,
    elapsedS,
    resnaps: s.resnaps,
    avgSpeedMps: s.progress?.avgSpeedMps ?? null,
  };
  // The trip ends at the destination: show it as fully travelled.
  const progress = s.progress && s.route
    ? { ...s.progress, alongM: s.route.lengthM, remainingM: 0, distanceToNextStepM: 0, nextStepIndex: s.route.steps.length - 1, etaS: 0 }
    : s.progress;
  tripStore.update({ status: 'arrived', summary, progress });
  follower = null;
  deps?.onArrived?.(summary);
}

const guide: CruiseRouteGuide = {
  planHop(position, links, panoId) {
    if (!follower) return { kind: 'arrived' };
    if (panoId && deps?.isOffline?.()) {
      const offline = planGraphHop(follower, panoId, position, links);
      if (offline) return offline;
    }
    return follower.planHop(position, links);
  },
  afterHop(position, moved) {
    if (!follower || !position) return;
    const progress = lastHopWasResnap && moved ? follower.noteResnap(position) : follower.notePosition(position);
    lastHopWasResnap = false;
    tripStore.update({ progress });
    if (moved) deps?.easeCarHeading?.(follower.routeBearingAhead(position));
  },
  async resnap(target) {
    if (!deps) return false;
    lastHopWasResnap = true;
    tripStore.update((s) => ({ resnaps: s.resnaps + 1 }));
    const ok = await deps.resnapTo(target);
    if (!ok) lastHopWasResnap = false;
    return ok;
  },
  arrived() {
    finish();
  },
};

/** The guide cruise should follow, or null for greedy cruise. Stable identity. */
export function getActiveRouteGuide(): CruiseRouteGuide | null {
  return follower && tripStore.get().status === 'driving' ? guide : null;
}

/** Test-only: drop module state between cases. */
export function resetTripControllerForTests(): void {
  clearTrip();
  deps = null;
  lastHopWasResnap = false;
  offlineGraph = null;
}
