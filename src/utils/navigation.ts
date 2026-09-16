import { getWasmModule, loadWasmModule } from '../wasm';
import { JS_FALLBACK as jsFallback } from '../wasm/jsFallback';

// Warm the module at import time — same "module-level cached api" shape as
// getWasmModule()/the feeders. normalizeAngle/signedAngleDiff/haversineDistance
// below must stay synchronous (callers include per-frame audio panning), so
// they read jsFallback directly until this resolves.
void loadWasmModule();

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
 * Normalize angle to [0, 360)
 * Handles negative angles and angles >= 360
 *
 * Delegates to the WASM `normalize_angle` export (or its JS fallback twin)
 * instead of a third copy of the formula — see docs/WASM_BRIDGE.md.
 */
export function normalizeAngle(angle: number): number {
    return (getWasmModule() ?? jsFallback).normalizeAngle(angle);
}

/**
 * Calculate the shortest signed angular difference [-180, 180]
 * Positive means rotate clockwise, negative means rotate counter-clockwise
 *
 * Delegates to the WASM `signed_angle_diff` export (or its JS fallback twin)
 * instead of a third copy of the formula — see docs/WASM_BRIDGE.md. Note the
 * argument order: this function is (target, current) = target - current,
 * while the WASM/fallback `signedAngleDiff` is (from, to) = to - from, so the
 * call below swaps them.
 */
export function signedAngleDiff(target: number, current: number): number {
    return (getWasmModule() ?? jsFallback).signedAngleDiff(current, target);
}

/**
 * Calculate the shortest absolute angular distance [0, 180]
 * Always returns a non-negative value representing the minimum rotation needed
 */
export function absoluteAngleDiff(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

/** Approximate Earth radius per unit — matches the WASM/fallback `haversine`'s R=6371000m. */
const EARTH_RADIUS_BY_UNIT = { km: 6371, mi: 3959, nm: 3440 } as const;
const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate great-circle distance between two lat/lng points using the haversine formula
 * @param lat1 - Latitude of first point in degrees
 * @param lon1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lon2 - Longitude of second point in degrees
 * @param unit - Unit for result: 'km' (default), 'mi' (miles), or 'nm' (nautical miles)
 * @returns Distance in specified unit
 *
 * Delegates to the WASM `haversine` export (or its JS fallback twin) for the
 * actual great-circle computation instead of a third copy of the formula —
 * see docs/WASM_BRIDGE.md. The unit conversion below reproduces the original
 * per-unit Earth radii exactly, as a ratio against the metres result.
 */
export function haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
    unit: 'km' | 'mi' | 'nm' = 'km'
): number {
    const meters = (getWasmModule() ?? jsFallback).haversine(lat1, lon1, lat2, lon2);
    return meters * (EARTH_RADIUS_BY_UNIT[unit] / EARTH_RADIUS_METERS);
}

/**
 * Calculate initial bearing (forward azimuth) from point 1 to point 2
 * @param lat1 - Latitude of starting point in degrees
 * @param lon1 - Longitude of starting point in degrees
 * @param lat2 - Latitude of destination point in degrees
 * @param lon2 - Longitude of destination point in degrees
 * @returns Initial bearing in degrees [0, 360), where 0 is North, 90 is East
 */
export function initialBearing(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const toRad = (deg: number) => deg * Math.PI / 180;
    const toDeg = (rad: number) => rad * 180 / Math.PI;
    
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    const θ = Math.atan2(y, x);
    return (toDeg(θ) + 360) % 360;
}
