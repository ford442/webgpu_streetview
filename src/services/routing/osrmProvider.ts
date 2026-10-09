/**
 * src/services/routing/osrmProvider.ts
 * Default route source: any OSRM-compatible HTTP endpoint (`/route/v1/driving`).
 *
 * GeoJSON geometry (`geometries=geojson&overview=full`) means no polyline
 * decoder dependency. The endpoint comes from runtime config
 * (`routingConfig.ts`); the public demo server is for development and low
 * volume only — production should point at a self-hosted OSRM / Valhalla
 * (OSRM-compatible mode) or a commercial OSRM-compatible host.
 */

import {
  RouteError,
  isValidLatLng,
  type LatLng,
  type Route,
  type RouteManeuver,
  type RouteProvider,
  type RouteRequest,
  type RouteStep,
} from './RouteProvider';

/** Requests that take longer than this fail as `network`, not hang the planner. */
export const OSRM_TIMEOUT_MS = 15000;

/** OSRM's demo server caps a request at 100 coordinates. */
export const OSRM_MAX_WAYPOINTS = 25;

interface OsrmManeuver {
  type?: string;
  modifier?: string;
  location?: [number, number];
  exit?: number;
}

interface OsrmStep {
  distance?: number;
  name?: string;
  maneuver?: OsrmManeuver;
}

interface OsrmRouteJson {
  distance?: number;
  duration?: number;
  geometry?: { type?: string; coordinates?: unknown };
  legs?: { steps?: OsrmStep[] }[];
}

interface OsrmResponseJson {
  code?: string;
  message?: string;
  routes?: OsrmRouteJson[];
}

export interface OsrmProviderOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function buildOsrmRouteUrl(endpoint: string, waypoints: readonly LatLng[]): string {
  const base = endpoint.replace(/\/+$/, '');
  const coords = waypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  return `${base}/route/v1/driving/${coords}?steps=true&geometries=geojson&overview=full`;
}

const TURN_BY_MODIFIER: Record<string, RouteManeuver> = {
  uturn: 'uturn',
  'sharp right': 'sharp-right',
  right: 'turn-right',
  'slight right': 'slight-right',
  straight: 'continue',
  'slight left': 'slight-left',
  left: 'turn-left',
  'sharp left': 'sharp-left',
};

/**
 * Map an OSRM maneuver to ours, or `null` for steps that are not a decision
 * the driver makes (notifications, roundabout exits that repeat the entry).
 */
export function mapOsrmManeuver(m: OsrmManeuver | undefined): RouteManeuver | null {
  const type = m?.type ?? '';
  const modifier = m?.modifier ?? '';
  switch (type) {
    case 'depart':
      return 'depart';
    case 'arrive':
      return 'arrive';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return 'roundabout';
    case 'exit roundabout':
    case 'exit rotary':
    case 'notification':
      return null;
    case 'merge':
      return 'merge';
    case 'fork':
      return modifier.includes('left') ? 'fork-left' : 'fork-right';
    default:
      // turn, new name, continue, end of road, on ramp, off ramp, …
      return TURN_BY_MODIFIER[modifier] ?? 'continue';
  }
}

function toLatLng(pair: unknown): LatLng | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const p = { lat: Number(pair[1]), lng: Number(pair[0]) };
  return isValidLatLng(p) ? p : null;
}

/** Parse an OSRM `/route` body into a {@link Route}, or throw `bad-response` / `no-route`. */
export function parseOsrmRoute(json: unknown): Route {
  const body = json as OsrmResponseJson | null;
  if (!body || typeof body !== 'object') throw new RouteError('bad-response', 'empty body');
  if (body.code && body.code !== 'Ok') {
    if (body.code === 'NoRoute' || body.code === 'NoSegment') {
      throw new RouteError('no-route', body.message ?? body.code);
    }
    throw new RouteError('bad-response', body.message ?? body.code);
  }
  const route = body.routes?.[0];
  if (!route) throw new RouteError('no-route', 'no routes in response');

  const coords = route.geometry?.coordinates;
  if (!Array.isArray(coords)) throw new RouteError('bad-response', 'route has no GeoJSON geometry');
  const polyline: LatLng[] = [];
  for (const c of coords) {
    const p = toLatLng(c);
    if (!p) throw new RouteError('bad-response', 'route geometry has an invalid coordinate');
    polyline.push(p);
  }
  if (polyline.length < 2) throw new RouteError('no-route', 'route geometry has fewer than two points');

  const legs = route.legs ?? [];
  const steps: RouteStep[] = [];
  legs.forEach((leg, legIndex) => {
    const lastLeg = legIndex === legs.length - 1;
    for (const s of leg.steps ?? []) {
      let maneuver = mapOsrmManeuver(s.maneuver);
      const distanceM = Number.isFinite(s.distance) ? Number(s.distance) : 0;
      // A via-point is a waypoint, not a stop: the next leg's depart and this
      // leg's arrive are one "continue" for the driver.
      if (maneuver === 'depart' && legIndex > 0) maneuver = null;
      if (maneuver === 'arrive' && !lastLeg) maneuver = 'continue';
      const location = toLatLng(s.maneuver?.location);
      if (maneuver === null || !location) {
        // Fold the road it covers into the previous step so totals still add up.
        const prev = steps[steps.length - 1];
        if (prev) prev.distanceM += distanceM;
        continue;
      }
      const step: RouteStep = { maneuver, name: s.name ?? '', location, distanceM };
      if (maneuver === 'roundabout' && Number.isFinite(s.maneuver?.exit)) step.exit = s.maneuver!.exit;
      steps.push(step);
    }
  });
  if (steps.length === 0 || steps[steps.length - 1]!.maneuver !== 'arrive') {
    steps.push({ maneuver: 'arrive', name: '', location: polyline[polyline.length - 1]!, distanceM: 0 });
  }

  return {
    polyline,
    distanceM: Number.isFinite(route.distance) ? Number(route.distance) : 0,
    durationS: Number.isFinite(route.duration) ? Number(route.duration) : 0,
    steps,
  };
}

export function createOsrmProvider(options: OsrmProviderOptions): RouteProvider {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? OSRM_TIMEOUT_MS;

  return {
    id: 'osrm',
    billable: false,
    async route(req: RouteRequest, signal: AbortSignal): Promise<Route> {
      if (req.waypoints.length < 2) {
        throw new RouteError('invalid-request', 'A route needs an origin and a destination.');
      }
      if (req.waypoints.length > OSRM_MAX_WAYPOINTS) {
        throw new RouteError('invalid-request', `At most ${OSRM_MAX_WAYPOINTS} stops per route.`);
      }
      if (!req.waypoints.every(isValidLatLng)) {
        throw new RouteError('invalid-request', 'Every stop needs a valid latitude and longitude.');
      }
      if (signal.aborted) throw new RouteError('aborted', 'aborted');

      const controller = new AbortController();
      let timedOut = false;
      const onAbort = (): void => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(buildOsrmRouteUrl(options.endpoint, req.waypoints), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        if (signal.aborted) throw new RouteError('aborted', 'aborted');
        throw new RouteError('network', timedOut ? `timed out after ${timeoutMs} ms` : String(err));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        const code = (json as OsrmResponseJson | null)?.code;
        if (code === 'NoRoute' || code === 'NoSegment') {
          throw new RouteError('no-route', (json as OsrmResponseJson).message ?? code);
        }
        throw new RouteError('http', `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      }
      if (json === null) throw new RouteError('bad-response', 'response is not JSON');
      return parseOsrmRoute(json);
    },
  };
}
