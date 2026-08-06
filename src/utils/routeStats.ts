/**
 * src/utils/routeStats.ts
 * Route length statistics for tours and prefetched route graphs.
 *
 * Distances come from the WASM module's `batch_haversine` export: the whole
 * polyline is copied into linear memory once and every segment is measured in a
 * single call, instead of one JS↔WASM boundary crossing per segment. Tours can
 * carry hundreds of waypoints and the Tour panel re-derives stats whenever the
 * list changes, so the batch form is what keeps that off the interaction path.
 *
 * A pure-JS fallback exists inside the module wrapper (src/wasm/index.ts), so
 * callers get identical numbers whether or not the binary loaded.
 */

import type { StreetViewWasmAPI } from '../wasm';

export interface RoutePoint {
    lat: number;
    lng: number;
}

export interface RouteStats {
    /** Total path length in metres (0 for fewer than two points). */
    totalMeters: number;
    /** Per-segment lengths in metres; `points.length - 1` entries. */
    segmentMeters: number[];
    /** Longest single hop in metres — flags suspicious teleports in a tour. */
    longestSegmentMeters: number;
    /** Mean hop length in metres (0 when there are no segments). */
    averageSegmentMeters: number;
}

const EMPTY_STATS: RouteStats = {
    totalMeters: 0,
    segmentMeters: [],
    longestSegmentMeters: 0,
    averageSegmentMeters: 0,
};

/** Flatten waypoints into the lat, lon, lat, lon, … layout batch_haversine reads. */
export function toLatLonPairs(points: readonly RoutePoint[]): Float64Array {
    const flat = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        flat[i * 2] = p.lat;
        flat[i * 2 + 1] = p.lng;
    }
    return flat;
}

/**
 * Measure a route in one WASM call.
 * Returns zeroed stats for fewer than two points.
 */
export function computeRouteStats(
    wasm: StreetViewWasmAPI,
    points: readonly RoutePoint[],
): RouteStats {
    if (points.length < 2) return EMPTY_STATS;

    const segmentCount = points.length - 1;
    const segments = new Float64Array(segmentCount);
    const totalMeters = wasm.batchHaversine(toLatLonPairs(points), segments);

    let longest = 0;
    for (let i = 0; i < segmentCount; i++) {
        const d = segments[i]!;
        if (d > longest) longest = d;
    }

    return {
        totalMeters,
        segmentMeters: Array.from(segments),
        longestSegmentMeters: longest,
        averageSegmentMeters: totalMeters / segmentCount,
    };
}

/**
 * Compact human-readable distance: metres under 1 km, otherwise kilometres
 * with one decimal.
 */
export function formatDistanceMetric(meters: number): string {
    if (!Number.isFinite(meters) || meters <= 0) return '0 m';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}
