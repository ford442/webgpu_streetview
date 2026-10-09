/**
 * src/services/routing/RouteProvider.ts
 * The route-source abstraction behind the routed road trip.
 *
 * A provider turns waypoints into a road polyline plus turn-by-turn steps. The
 * default is an OSRM-compatible HTTP endpoint (`osrmProvider.ts`); nothing here
 * is Google-specific, so a provider that bills per request has to say so
 * (`billable`) and is never the default — see BILLING_SAFETY_CHECKLIST.md.
 *
 * A provider never invents a route: every failure is a {@link RouteError} with
 * a kind the UI can explain honestly (unconfigured, unreachable, no route, …).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteRequest {
  /** Origin, optional via-points, destination — at least two. */
  waypoints: LatLng[];
  profile: 'driving';
}

export type RouteManeuver =
  | 'depart'
  | 'continue'
  | 'turn-left'
  | 'turn-right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'merge'
  | 'fork-left'
  | 'fork-right'
  | 'roundabout'
  | 'arrive';

export interface RouteStep {
  maneuver: RouteManeuver;
  /** Road the step travels on ('' when the provider has no name for it). */
  name: string;
  /** Where the maneuver happens. */
  location: LatLng;
  /** Length of the road travelled *after* the maneuver, in metres. */
  distanceM: number;
  /** Roundabout exit number, when the provider reports one. */
  exit?: number;
}

export interface Route {
  /** Full-resolution road geometry, origin to destination. */
  polyline: LatLng[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
}

export interface RouteProvider {
  readonly id: string;
  /** True when each `route()` call costs money (Google Directions). */
  readonly billable: boolean;
  route(req: RouteRequest, signal: AbortSignal): Promise<Route>;
}

export type RouteErrorKind =
  /** No endpoint is configured — routing is off, not broken. */
  | 'unconfigured'
  /** The request never got an HTTP answer (offline, DNS, CORS, timeout). */
  | 'network'
  /** The server answered with a non-2xx status. */
  | 'http'
  /** The server answered, but there is no drivable route between the points. */
  | 'no-route'
  /** The answer did not have the shape a route needs. */
  | 'bad-response'
  | 'aborted'
  | 'invalid-request'
  /** The session call meter refused the request. */
  | 'budget';

export class RouteError extends Error {
  readonly kind: RouteErrorKind;

  constructor(kind: RouteErrorKind, message: string) {
    super(message);
    this.name = 'RouteError';
    this.kind = kind;
  }
}

/** One line a person can read, for any error a provider threw. */
export function describeRouteError(err: unknown): string {
  if (err instanceof RouteError) {
    switch (err.kind) {
      case 'unconfigured':
        return 'Routing is not configured on this deployment (set ROUTING_ENDPOINT in config.js).';
      case 'network':
        return 'The routing server could not be reached. Check your connection and try again.';
      case 'http':
        return `The routing server returned an error (${err.message}).`;
      case 'no-route':
        return 'No drivable route was found between those points.';
      case 'bad-response':
        return 'The routing server sent a response this app could not read.';
      case 'aborted':
        return 'Route request cancelled.';
      case 'invalid-request':
        return err.message;
      case 'budget':
        return 'This session has used its routing request budget.';
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    p != null
    && Number.isFinite(p.lat)
    && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90
    && Math.abs(p.lng) <= 180
  );
}
