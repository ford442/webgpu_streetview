/**
 * `.svtrip` files and `?trip=` links.
 *
 * A file is the versioned recording JSON (`tripRecording.ts`), gzipped with
 * the browser's `CompressionStream` — no compression dependency. Import also
 * accepts plain JSON. A link carries a compact form of the same recording
 * (hop deltas, rounded view, the environment only where it changes), gzipped
 * and base64url'd; it is offered only when that stays under
 * {@link TRIP_LINK_MAX_CHARS}, otherwise the trip is shared as a file.
 *
 * Both are only metadata: a replay re-requests every pano by id, metered, on
 * the viewer's own Maps quota.
 */

import { readFlag } from '../config/flags';
import { MAX_TRIP_HOPS, TRIP_FORMAT_VERSION, parseTripRecording, type TripHop, type TripRecording } from './tripRecording';

export const TRIP_FILE_EXTENSION = '.svtrip';
export const TRIP_FILE_MIME = 'application/vnd.webgpu-streetview.trip+gzip';
export const TRIP_LINK_PARAM = 'trip';
/** A `?trip=` payload longer than this is shared as a file instead. */
export const TRIP_LINK_MAX_CHARS = 2048;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

export async function encodeTripFile(recording: TripRecording): Promise<Blob> {
  return new Blob([await gzip(JSON.stringify(recording)) as BlobPart], { type: TRIP_FILE_MIME });
}

/** Read an imported `.svtrip` (gzip) or plain JSON file; null when it is not a valid recording. */
export async function decodeTripFile(file: Blob): Promise<TripRecording | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = isGzip(bytes) ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    return parseTripRecording(JSON.parse(text));
  } catch {
    return null;
  }
}

export function tripFileName(recording: TripRecording): string {
  const slug = recording.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'road-trip';
  return `${slug}${TRIP_FILE_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Link form
// ---------------------------------------------------------------------------

/** Environment row: [hop index, rain, snow, wind, fog, timeOfDay, nightIntensity, look]. */
type WireEnv = [number, number, number, number, number, string, number, string | null];
/** Hop row: [Δt ms, pano id, lat, lng, heading, pitch, zoom, carHeading, pano date]. */
type WireHop = [number, string, number, number, number, number, number, number, string | null];

interface WireTrip {
  v: number;
  i: string;
  n: string;
  c: string;
  r: string;
  s: [number, number, string][];
  h: WireHop[];
  e: WireEnv[];
  x: number;
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

const envKey = (h: TripHop): string =>
  JSON.stringify([h.weather.rain, h.weather.snow, h.weather.wind, h.weather.fog, h.weather.timeOfDay, h.nightIntensity, h.look]);

function toWire(r: TripRecording): WireTrip {
  const e: WireEnv[] = [];
  let lastEnv = '';
  let lastT = 0;
  const h = r.hops.map((hop, i): WireHop => {
    const key = envKey(hop);
    if (key !== lastEnv) {
      lastEnv = key;
      e.push([i, round(hop.weather.rain, 3), round(hop.weather.snow, 3), round(hop.weather.wind, 3), round(hop.weather.fog, 3),
        hop.weather.timeOfDay, round(hop.nightIntensity, 3), hop.look]);
    }
    const dt = Math.round(hop.t - lastT);
    lastT += dt;
    return [dt, hop.panoId, round(hop.lat, 6), round(hop.lng, 6), round(hop.heading, 1), round(hop.pitch, 1),
      round(hop.zoom, 2), round(hop.carHeading, 1), hop.panoDate];
  });
  return {
    v: TRIP_FORMAT_VERSION,
    i: r.id,
    n: r.name,
    c: r.createdAt,
    r: r.routeId,
    s: r.stops.map((s) => [round(s.lat, 6), round(s.lng, 6), s.label]),
    h,
    e,
    x: r.truncated ? 1 : 0,
  };
}

function fromWire(w: unknown): TripRecording | null {
  if (typeof w !== 'object' || w === null) return null;
  const t = w as Partial<WireTrip>;
  if (!Array.isArray(t.h) || !Array.isArray(t.e) || !Array.isArray(t.s) || t.h.length > MAX_TRIP_HOPS) return null;
  let time = 0;
  let env: WireEnv | undefined;
  let nextEnv = 0;
  const hops = t.h.map((row, i) => {
    while (nextEnv < t.e!.length && Number(t.e![nextEnv]?.[0]) <= i) env = t.e![nextEnv++];
    const [dt, panoId, lat, lng, heading, pitch, zoom, carHeading, panoDate] = Array.isArray(row) ? row : [];
    time += Number(dt);
    return {
      t: time, panoId, lat, lng, heading, pitch, zoom, carHeading, panoDate,
      weather: env && { rain: env[1], snow: env[2], wind: env[3], fog: env[4], timeOfDay: env[5] },
      nightIntensity: env?.[6],
      look: env?.[7] ?? null,
    };
  });
  return parseTripRecording({
    version: t.v,
    id: t.i,
    name: t.n,
    createdAt: t.c,
    routeId: t.r,
    stops: t.s.map((s) => (Array.isArray(s) ? { lat: s[0], lng: s[1], label: s[2] } : null)),
    hops,
    stills: [],
    durationMs: time,
    truncated: t.x === 1,
  });
}

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The `?trip=` payload, or null when the recording is too long for a link. */
export async function encodeTripLink(recording: TripRecording): Promise<string | null> {
  const payload = toBase64Url(await gzip(JSON.stringify(toWire(recording))));
  return payload.length <= TRIP_LINK_MAX_CHARS ? payload : null;
}

export async function decodeTripLink(payload: string | null | undefined): Promise<TripRecording | null> {
  if (!payload || payload.length > TRIP_LINK_MAX_CHARS * 2) return null;
  try {
    return fromWire(JSON.parse(await gunzip(fromBase64Url(payload))));
  } catch {
    return null;
  }
}

/** A link to this page that replays the recording, or null when it needs a file. */
export async function buildTripLinkUrl(recording: TripRecording, base: string = window.location.href): Promise<string | null> {
  const payload = await encodeTripLink(recording);
  if (!payload) return null;
  const url = new URL(base);
  url.searchParams.delete('route');
  url.searchParams.set(TRIP_LINK_PARAM, payload);
  return url.toString();
}

/** The `?trip=` recording of the current page, if any. */
export function readTripLink(search?: string): Promise<TripRecording | null> {
  return decodeTripLink(readFlag('trip', search) as string | undefined);
}
