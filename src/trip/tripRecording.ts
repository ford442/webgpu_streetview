/**
 * A recorded road trip: one record per hop with the pano, its capture date,
 * the view, and the user's own environment settings at that moment. This is
 * the `.svtrip` payload (see `tripFile.ts`) and what `tripReplay.ts` plays.
 *
 * Only metadata and our own state — pano ids, coordinates, POV, the weather
 * the user *set* (not live conditions), the look. Never imagery: a replay
 * re-requests every pano from Google by id, metered.
 */

import type { TimeOfDay } from '../hooks/useEnvironmentSettings';
import type { TripStop } from '../state/tripStore';

/** Bump on an incompatible change; `parseTripRecording` rejects other versions. */
export const TRIP_FORMAT_VERSION = 1;

/** Recording stops appending past this many hops (`truncated` is set). */
export const MAX_TRIP_HOPS = 5000;

/** Snapshots listed in a recording's album. */
export const MAX_TRIP_STILLS = 50;

/** The weather and light the user set — restored on replay. */
interface TripWeatherSnapshot {
  rain: number;
  snow: number;
  wind: number;
  fog: number;
  timeOfDay: TimeOfDay;
}

export interface TripHop {
  /** Milliseconds since the recording started. */
  t: number;
  panoId: string;
  /** Capture date `YYYY-MM` when known (prefetched graph, historical mode, or a replay lookup). */
  panoDate: string | null;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  carHeading: number;
  weather: TripWeatherSnapshot;
  look: string | null;
  nightIntensity: number;
}

/** A snapshot taken during the trip (the image itself stays in the gallery). */
export interface TripStill {
  t: number;
  snapshotId: string;
  name: string;
  lat: number;
  lng: number;
  panoId: string | null;
}

export interface TripRecording {
  version: typeof TRIP_FORMAT_VERSION;
  id: string;
  name: string;
  /** ISO time the recording started. */
  createdAt: string;
  routeId: string;
  /** The planned stops — a replay link plans the same route from them. */
  stops: TripStop[];
  hops: TripHop[];
  stills: TripStill[];
  /** Duration in ms (last hop's `t` while recording). */
  durationMs: number;
  truncated: boolean;
}

const TIMES: readonly TimeOfDay[] = ['day', 'sunrise', 'sunset', 'night'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseWeather(v: unknown): TripWeatherSnapshot | null {
  if (!isObj(v)) return null;
  const { rain, snow, wind, fog, timeOfDay } = v;
  if (!isNum(rain) || !isNum(snow) || !isNum(wind) || !isNum(fog)) return null;
  if (!TIMES.includes(timeOfDay as TimeOfDay)) return null;
  return { rain, snow, wind, fog, timeOfDay: timeOfDay as TimeOfDay };
}

function parseHop(v: unknown): TripHop | null {
  if (!isObj(v)) return null;
  const weather = parseWeather(v.weather);
  const nums = ['t', 'lat', 'lng', 'heading', 'pitch', 'zoom', 'carHeading', 'nightIntensity'] as const;
  if (!weather || !isStr(v.panoId) || v.panoId.length === 0 || !nums.every((k) => isNum(v[k]))) return null;
  if (Math.abs(v.lat as number) > 90 || Math.abs(v.lng as number) > 180) return null;
  return {
    t: v.t as number,
    panoId: v.panoId,
    panoDate: isStr(v.panoDate) ? v.panoDate : null,
    lat: v.lat as number,
    lng: v.lng as number,
    heading: v.heading as number,
    pitch: v.pitch as number,
    zoom: v.zoom as number,
    carHeading: v.carHeading as number,
    weather,
    look: isStr(v.look) ? v.look : null,
    nightIntensity: v.nightIntensity as number,
  };
}

function parseStill(v: unknown): TripStill | null {
  if (!isObj(v) || !isNum(v.t) || !isStr(v.snapshotId) || !isNum(v.lat) || !isNum(v.lng)) return null;
  return {
    t: v.t,
    snapshotId: v.snapshotId,
    name: isStr(v.name) ? v.name : '',
    lat: v.lat,
    lng: v.lng,
    panoId: isStr(v.panoId) ? v.panoId : null,
  };
}

function parseStop(v: unknown): TripStop | null {
  if (!isObj(v) || !isNum(v.lat) || !isNum(v.lng)) return null;
  return { lat: v.lat, lng: v.lng, label: isStr(v.label) ? v.label : '' };
}

/**
 * Validate untrusted input (an imported file, a `?trip=` link, a shared
 * session) into a recording. Any malformed hop rejects the whole recording:
 * a replay that silently skips hops would not be the drive that was shared.
 */
export function parseTripRecording(input: unknown): TripRecording | null {
  if (!isObj(input) || input.version !== TRIP_FORMAT_VERSION) return null;
  if (!isStr(input.id) || !isStr(input.routeId) || !Array.isArray(input.hops) || !Array.isArray(input.stops)) return null;
  if (input.hops.length === 0 || input.hops.length > MAX_TRIP_HOPS) return null;
  const hops: TripHop[] = [];
  for (const raw of input.hops) {
    const hop = parseHop(raw);
    if (!hop) return null;
    hops.push(hop);
  }
  const stops = input.stops.map(parseStop);
  if (stops.length < 2 || stops.some((s) => s === null)) return null;
  const stills = (Array.isArray(input.stills) ? input.stills : [])
    .slice(0, MAX_TRIP_STILLS)
    .map(parseStill)
    .filter((s): s is TripStill => s !== null);
  return {
    version: TRIP_FORMAT_VERSION,
    id: input.id,
    name: isStr(input.name) ? input.name.slice(0, 120) : 'Road trip',
    createdAt: isStr(input.createdAt) ? input.createdAt : new Date(0).toISOString(),
    routeId: input.routeId,
    stops: stops as TripStop[],
    hops,
    stills,
    durationMs: isNum(input.durationMs) ? input.durationMs : hops[hops.length - 1]!.t,
    truncated: input.truncated === true,
  };
}
