import { requireWasm } from '../wasm';

// normalizeAngle / signedAngleDiff / haversineMeters are one-line f64 maths and
// stay in TypeScript: callers include per-frame audio panning and boot-time UI,
// and a WASM round trip would both throw before the binary loads and (for the
// f32 angle exports) round f64 headings. Batch geometry — polylines, route
// lengths, bearings and offsets — goes through the WASM kernels (#341).

/**
 * Default half-angle of the cone a link must fall in to count as "this way".
 * Deliberately tight so WASD/right-click steps go where the user is looking.
 */
export const DEFAULT_LINK_CONE_DEG = 45;

export function findBestLink(
    links: google.maps.StreetViewLink[],
    currentHeading: number,
    direction: 'forward' | 'backward' | 'left' | 'right',
    /**
     * Widen the cone for callers that would rather follow the road than stall
     * (cruise mode re-aims onto the nearest link instead of counting a stuck
     * hop). Manual navigation keeps the tight default.
     */
    maxAngleDiff: number = DEFAULT_LINK_CONE_DEG
): google.maps.StreetViewLink | null {
    if (!links || links.length === 0) {
        return null;
    }

    let targetHeading: number;
    switch (direction) {
        case 'forward':
            targetHeading = currentHeading;
            break;
        case 'backward':
            targetHeading = (currentHeading + 180) % 360;
            break;
        case 'left':
            targetHeading = (currentHeading - 90 + 360) % 360;
            break;
        case 'right':
            targetHeading = (currentHeading + 90) % 360;
            break;
    }

    let bestLink: google.maps.StreetViewLink | null = null;
    // Only return a link that is reasonably close to the target direction.
    let smallestAngleDiff = maxAngleDiff;

    for (const link of links) {
        if (link.heading == null) continue;

        const angleDiff = absoluteAngleDiff(targetHeading, link.heading);

        if (angleDiff < smallestAngleDiff) {
            smallestAngleDiff = angleDiff;
            bestLink = link;
        }
    }

    return bestLink;
}

/**
 * Normalise an angle in degrees to [0, 360). An angle already in range comes
 * back unchanged (no `+ 360` round trip through a coarser exponent).
 */
export function normalizeAngle(angle: number): number {
    const r = angle % 360;
    if (r >= 0) return r + 0; // + 0 folds -0 into 0
    const wrapped = r + 360;
    // A tiny negative remainder rounds up to 360, which is 0.
    return wrapped < 360 ? wrapped : 0;
}

/**
 * Shortest signed angular difference `target - current`, in [-180, 180).
 * Positive means rotate clockwise, negative counter-clockwise; exactly
 * opposite headings give -180 (never +180).
 *
 * JS `%` keeps the dividend's sign (like C `fmod`), so the remainder is in
 * (-360, 360) and takes at most one ±360 correction. A difference already in
 * range is returned exactly — no `+ 180` offset to round it.
 */
export function signedAngleDiff(target: number, current: number): number {
    const diff = (target - current) % 360;
    if (diff >= 180) return diff - 360;
    if (diff < -180) return diff + 360;
    return diff;
}

/**
 * Calculate the shortest absolute angular distance [0, 180]
 * Always returns a non-negative value representing the minimum rotation needed
 */
export function absoluteAngleDiff(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

/** Approximate Earth radius per unit; metres match the WASM geodesy kernels' R. */
const EARTH_RADIUS_BY_UNIT = { km: 6371, mi: 3959, nm: 3440 } as const;
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Haversine great-circle distance in metres (R = 6371000 m) — the same formula
 * as `sw_haversine` in cpp/src/geodesy_module.cpp, which the batch kernels
 * (`batchHaversine`, `polylineProject`, …) use per segment. Identical points
 * give exactly 0.
 */
export function haversineMeters(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
): number {
    const dLat = (lat2 - lat1) * DEG_TO_RAD;
    const dLon = (lon2 - lon1) * DEG_TO_RAD;
    const sinLat = Math.sin(dLat * 0.5);
    const sinLon = Math.sin(dLon * 0.5);
    const a = sinLat * sinLat
        + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * sinLon * sinLon;
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate great-circle distance between two lat/lng points using the haversine formula
 * @param lat1 - Latitude of first point in degrees
 * @param lon1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lon2 - Longitude of second point in degrees
 * @param unit - Unit for result: 'km' (default), 'mi' (miles), or 'nm' (nautical miles)
 * @returns Distance in specified unit
 *
 * {@link haversineMeters} scaled by the per-unit Earth radius.
 */
export function haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
    unit: 'km' | 'mi' | 'nm' = 'km'
): number {
    const meters = haversineMeters(lat1, lon1, lat2, lon2);
    return meters * (EARTH_RADIUS_BY_UNIT[unit] / EARTH_RADIUS_METERS);
}

/**
 * Calculate initial bearing (forward azimuth) from point 1 to point 2
 * @param lat1 - Latitude of starting point in degrees
 * @param lon1 - Longitude of starting point in degrees
 * @param lat2 - Latitude of destination point in degrees
 * @param lon2 - Longitude of destination point in degrees
 * @returns Initial bearing in degrees [0, 360), where 0 is North, 90 is East
 *
 * Delegates to the WASM `initial_bearing` export —
 * route following, cruise and the offline graph walk all share that one copy.
 */
export function initialBearing(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    return requireWasm().initialBearing(lat1, lon1, lat2, lon2);
}
