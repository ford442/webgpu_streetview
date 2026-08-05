import { loadWasmModule, _resetWasmModule, type StreetViewWasmAPI } from '../wasm';
import { computeRouteStats, formatDistanceMetric, toLatLonPairs } from './routeStats';
import { haversineDistance } from './navigation';

let wasm: StreetViewWasmAPI;

beforeEach(async () => {
    _resetWasmModule();
    // fetch() is unavailable under vitest, so this resolves to the JS fallback —
    // the same code path a browser without the binary takes.
    wasm = await loadWasmModule();
});

describe('toLatLonPairs', () => {
    it('flattens to lat, lon, lat, lon order', () => {
        const flat = toLatLonPairs([
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
        ]);
        expect(Array.from(flat)).toEqual([1, 2, 3, 4]);
    });

    it('returns an empty array for no points', () => {
        expect(toLatLonPairs([]).length).toBe(0);
    });
});

describe('computeRouteStats', () => {
    it('returns zeroed stats for fewer than two points', () => {
        expect(computeRouteStats(wasm, [])).toEqual({
            totalMeters: 0,
            segmentMeters: [],
            longestSegmentMeters: 0,
            averageSegmentMeters: 0,
        });
        expect(computeRouteStats(wasm, [{ lat: 1, lng: 2 }]).totalMeters).toBe(0);
    });

    it('measures each segment and totals them', () => {
        const points = [
            { lat: 40.7128, lng: -74.006 },
            { lat: 51.5074, lng: -0.1278 },
            { lat: 48.8566, lng: 2.3522 },
        ];
        const stats = computeRouteStats(wasm, points);

        expect(stats.segmentMeters).toHaveLength(2);
        expect(stats.segmentMeters[0]).toBeCloseTo(
            wasm.haversine(40.7128, -74.006, 51.5074, -0.1278),
            6,
        );
        expect(stats.segmentMeters[1]).toBeCloseTo(
            wasm.haversine(51.5074, -0.1278, 48.8566, 2.3522),
            6,
        );
        expect(stats.totalMeters).toBeCloseTo(
            stats.segmentMeters[0]! + stats.segmentMeters[1]!,
            6,
        );
    });

    it('agrees with the pure-TS haversineDistance in navigation.ts', () => {
        const points = [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 34.0522, lng: -118.2437 },
            { lat: 32.7157, lng: -117.1611 },
        ];
        const stats = computeRouteStats(wasm, points);
        let expectedKm = 0;
        for (let i = 0; i < points.length - 1; i++) {
            expectedKm += haversineDistance(
                points[i]!.lat, points[i]!.lng,
                points[i + 1]!.lat, points[i + 1]!.lng,
                'km',
            );
        }
        // navigation.ts uses R = 6371 km; the WASM module uses 6371000 m.
        expect(stats.totalMeters / 1000).toBeCloseTo(expectedKm, 6);
    });

    it('reports the longest and average hop', () => {
        // A short hop then a long one.
        const stats = computeRouteStats(wasm, [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.001 },
            { lat: 0, lng: 10 },
        ]);
        expect(stats.longestSegmentMeters).toBe(
            Math.max(stats.segmentMeters[0]!, stats.segmentMeters[1]!),
        );
        expect(stats.longestSegmentMeters).toBe(stats.segmentMeters[1]);
        expect(stats.averageSegmentMeters).toBeCloseTo(stats.totalMeters / 2, 6);
    });

    it('treats a repeated waypoint as a zero-length segment', () => {
        const stats = computeRouteStats(wasm, [
            { lat: 12.34, lng: 56.78 },
            { lat: 12.34, lng: 56.78 },
        ]);
        expect(stats.totalMeters).toBe(0);
        expect(stats.segmentMeters).toEqual([0]);
        expect(stats.longestSegmentMeters).toBe(0);
    });

    it('scales to a long route without breaking the total', () => {
        // 200 waypoints marching east along the equator, ~0.001° apart.
        const points = Array.from({ length: 200 }, (_, i) => ({ lat: 0, lng: i * 0.001 }));
        const stats = computeRouteStats(wasm, points);
        expect(stats.segmentMeters).toHaveLength(199);
        const sum = stats.segmentMeters.reduce((a, b) => a + b, 0);
        expect(stats.totalMeters).toBeCloseTo(sum, 6);
        // Every hop is the same length on the equator.
        expect(stats.longestSegmentMeters).toBeCloseTo(stats.averageSegmentMeters, 6);
    });
});

describe('formatDistanceMetric', () => {
    it.each([
        [0, '0 m'],
        [-5, '0 m'],
        [12.4, '12 m'],
        [999, '999 m'],
        [1000, '1.0 km'],
        [5570000, '5570.0 km'],
    ])('formats %f m as %s', (meters, expected) => {
        expect(formatDistanceMetric(meters)).toBe(expected);
    });

    it('handles non-finite input', () => {
        expect(formatDistanceMetric(NaN)).toBe('0 m');
        expect(formatDistanceMetric(Infinity)).toBe('0 m');
    });
});
