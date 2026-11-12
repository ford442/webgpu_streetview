/**
 * The shape of a planned road route. Lives in `types/` so `state/` (the trip store) and
 * `services/routing` can both name it without one importing the other (#368).
 */

export interface LatLng {
  lat: number;
  lng: number;
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
  exit?: number | undefined;
}

export interface Route {
  /** Full-resolution road geometry, origin to destination. */
  polyline: LatLng[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
}

export interface RoutedStep extends RouteStep {
  /** Where the maneuver sits along the route, in metres from the origin. */
  alongM: number;
}

export interface ActiveRoute {
  /** Stable for the same stops — keys prefetch graphs and shared sessions. */
  id: string;
  providerId: string;
  /** The stops the route was planned through (origin first). */
  stops: LatLng[];
  polyline: LatLng[];
  /** `polyline` as lat, lng, lat, lng, … for the kernels. */
  flat: Float64Array;
  /** Along-track distance of each polyline vertex. */
  cumulativeM: Float64Array;
  /** Geometric length (what along-track distances are measured against). */
  lengthM: number;
  /** Evenly spaced points every {@link ROUTE_RESAMPLE_STEP_M} metres. */
  resampled: Float64Array;
  /** Provider's road distance and driving duration (for the ETA). */
  distanceM: number;
  durationS: number;
  steps: RoutedStep[];
}
