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
import { tripStore, type TripStop, type TripSummary } from '../../state/tripStore';
import { getMapsCallBudget } from '../maps/callBudget';
import { RouteFollower, type RouteFollowConfig } from './routeFollow';
import { buildActiveRoute, type ActiveRoute } from './routeGeometry';
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
}

let deps: TripControllerDeps | null = null;
let follower: RouteFollower | null = null;
let lastHopWasResnap = false;
let planAbort: AbortController | null = null;

export function configureTripController(next: TripControllerDeps | null): void {
  deps = next;
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
  follower = new RouteFollower(route, deps?.followConfig, now);
  lastHopWasResnap = false;
  const progress = position ? follower.notePosition(position) : null;
  tripStore.update({ status: 'driving', progress, resnaps: 0, startedAt: now(), summary: null });
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
  planHop(position, links) {
    if (!follower) return { kind: 'arrived' };
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
}
