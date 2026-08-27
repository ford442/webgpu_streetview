/**
 * historicalImagery.ts
 *
 * Data acquisition for the Historical Timeline ("time travel") feature.
 *
 * Google's Street View JS API has no endpoint that lists every historical
 * capture for a location. The only usable levers are:
 *   - `StreetViewPanoramaData.imageDate` on whichever panorama a query
 *     resolves to (works for both `{ pano }` and `{ location }` lookups).
 *   - Nearby panoramas within a small radius sometimes resolve to a
 *     *different* capture (Google occasionally keeps an older pano reachable
 *     a few meters from the newest one along the same stretch of road).
 *
 * `crawlHistoricalImagery` samples a small ring of points around the given
 * center (plus the center itself) and dedupes whatever distinct
 * `imageDate` values come back. This is a best-effort scan, not a complete
 * archive — most locations will only ever yield 1-2 distinct dates.
 */

export interface HistoricalPanoEntry {
  panoId: string;
  /** Capture date string from Google, e.g. "2022-05". */
  imageDate: string;
  lat: number;
  lng: number;
  /** Attribution string Google requires be shown alongside the imagery. */
  copyright: string | null;
}

export interface CrawlOptions {
  /** Ring radius in meters to sample around the center point. Default 10m. */
  radiusMeters?: number;
  /** Number of points sampled around the ring (plus the center). Default 8. */
  sampleCount?: number;
  /** Passed through to StreetViewService.getPanorama's `radius` param. */
  searchRadiusMeters?: number;
}

const DEFAULT_OPTIONS: Required<CrawlOptions> = {
  radiusMeters: 10,
  sampleCount: 8,
  searchRadiusMeters: 50,
};

const EARTH_RADIUS_METERS = 6371000;

/** Offsets a lat/lng by `distanceMeters` along `bearingDeg` (0 = north, clockwise). */
export function offsetLatLng(
  lat: number,
  lng: number,
  distanceMeters: number,
  bearingDeg: number
): { lat: number; lng: number } {
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const newLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad)
    );

  return { lat: (newLatRad * 180) / Math.PI, lng: (newLngRad * 180) / Math.PI };
}

/** Builds the ring of sample points (center first) used by the crawl. */
export function buildSamplePoints(
  centerLat: number,
  centerLng: number,
  opts: CrawlOptions = {}
): Array<{ lat: number; lng: number }> {
  const { radiusMeters, sampleCount } = { ...DEFAULT_OPTIONS, ...opts };
  const points = [{ lat: centerLat, lng: centerLng }];
  for (let i = 0; i < sampleCount; i++) {
    const bearing = (360 / sampleCount) * i;
    points.push(offsetLatLng(centerLat, centerLng, radiusMeters, bearing));
  }
  return points;
}

/**
 * Dedupe a list of raw (panoId, imageDate) results down to one entry per
 * distinct `imageDate`, keeping the first (closest-sampled) occurrence, and
 * sorts the result chronologically ascending.
 */
export function dedupeByDate(entries: HistoricalPanoEntry[]): HistoricalPanoEntry[] {
  const seen = new Map<string, HistoricalPanoEntry>();
  for (const entry of entries) {
    if (!entry.imageDate) continue;
    if (!seen.has(entry.imageDate)) {
      seen.set(entry.imageDate, entry);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.imageDate.localeCompare(b.imageDate));
}

function queryPanorama(
  service: google.maps.StreetViewService,
  location: { lat: number; lng: number },
  searchRadiusMeters: number
): Promise<HistoricalPanoEntry | null> {
  return new Promise((resolve) => {
    service.getPanorama(
      { location: new google.maps.LatLng(location.lat, location.lng), radius: searchRadiusMeters },
      (data, status) => {
        if (status !== google.maps.StreetViewStatus.OK || !data?.location?.pano) {
          resolve(null);
          return;
        }
        const panoData = data as google.maps.StreetViewPanoramaData;
        const latLng = panoData.location?.latLng;
        resolve({
          panoId: panoData.location!.pano!,
          imageDate: panoData.imageDate ?? '',
          lat: latLng ? latLng.lat() : location.lat,
          lng: latLng ? latLng.lng() : location.lng,
          copyright: panoData.copyright ?? null,
        });
      }
    );
  });
}

/**
 * Samples a small ring around (centerLat, centerLng) and returns the
 * distinct capture dates found, sorted chronologically. Never rejects —
 * network/quota failures for individual sample points are swallowed.
 */
export async function crawlHistoricalImagery(
  centerLat: number,
  centerLng: number,
  opts: CrawlOptions = {}
): Promise<HistoricalPanoEntry[]> {
  if (typeof google === 'undefined' || !google.maps) return [];
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  const service = new google.maps.StreetViewService();
  const points = buildSamplePoints(centerLat, centerLng, merged);

  const results = await Promise.all(
    points.map((p) => queryPanorama(service, p, merged.searchRadiusMeters).catch(() => null))
  );

  const found = results.filter((r): r is HistoricalPanoEntry => r !== null && !!r.imageDate);
  return dedupeByDate(found);
}

// --- localStorage cache (keyed by a coarse lat/lng grid cell) -------------

const CACHE_KEY_PREFIX = 'webgpu_streetview_historical_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GRID_PRECISION = 4; // ~11m grid cells at the equator

interface CacheRecord {
  entries: HistoricalPanoEntry[];
  cachedAt: number;
}

function cellKey(lat: number, lng: number): string {
  return `${CACHE_KEY_PREFIX}${lat.toFixed(GRID_PRECISION)}_${lng.toFixed(GRID_PRECISION)}`;
}

export function readHistoricalCache(lat: number, lng: number): HistoricalPanoEntry[] | null {
  try {
    const raw = localStorage.getItem(cellKey(lat, lng));
    if (!raw) return null;
    const record: CacheRecord = JSON.parse(raw);
    if (Date.now() - record.cachedAt > CACHE_TTL_MS) return null;
    return record.entries;
  } catch {
    return null;
  }
}

export function writeHistoricalCache(lat: number, lng: number, entries: HistoricalPanoEntry[]): void {
  try {
    const record: CacheRecord = { entries, cachedAt: Date.now() };
    localStorage.setItem(cellKey(lat, lng), JSON.stringify(record));
  } catch {
    // Storage full or unavailable — caching is a pure optimization, skip silently.
  }
}

/**
 * Cached wrapper around `crawlHistoricalImagery`: serves a fresh cache hit
 * without touching the network, otherwise crawls and populates the cache.
 */
export async function getHistoricalImagery(
  centerLat: number,
  centerLng: number,
  opts: CrawlOptions = {}
): Promise<HistoricalPanoEntry[]> {
  const cached = readHistoricalCache(centerLat, centerLng);
  if (cached) return cached;

  const entries = await crawlHistoricalImagery(centerLat, centerLng, opts);
  writeHistoricalCache(centerLat, centerLng, entries);
  return entries;
}

/** Formats "2022-05" -> "May 2022", or passes through partial/odd formats untouched. */
export function formatImageDate(imageDate: string): string {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(imageDate);
  if (!match) return imageDate;
  const [, year, month] = match;
  if (!month) return year!;
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const idx = parseInt(month, 10) - 1;
  const label = monthNames[idx] ?? month;
  return `${label} ${year}`;
}

/**
 * Pick the first timeline entry whose `imageDate` starts with a 4-digit year.
 * Reuses the existing #221 archive — does not crawl.
 */
export function pickHistoricalEntryForYear(
  entries: readonly HistoricalPanoEntry[],
  year: string | number | null | undefined,
): HistoricalPanoEntry | null {
  const y = String(year ?? '').trim();
  if (!/^\d{4}$/.test(y)) return null;
  return entries.find((e) => e.imageDate.startsWith(y)) ?? null;
}
