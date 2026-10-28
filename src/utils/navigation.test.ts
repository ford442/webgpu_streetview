import { _installWasmModule, _resetWasmModule, requireWasm } from '../wasm';
import {
    findBestLink,
    haversineDistance,
    haversineMeters,
    normalizeAngle,
    signedAngleDiff,
} from './navigation';

describe('findBestLink', () => {
    const links: google.maps.StreetViewLink[] = [
        { heading: 0, pano: 'north', description: '' },
        { heading: 90, pano: 'east', description: '' },
        { heading: 180, pano: 'south', description: '' },
        { heading: 270, pano: 'west', description: '' },
    ];

    it('returns null for empty links', () => {
        expect(findBestLink([], 0, 'forward')).toBeNull();
    });

    it('finds forward link correctly', () => {
        const result = findBestLink(links, 0, 'forward');
        expect(result?.pano).toBe('north');
    });

    it('finds backward link correctly', () => {
        const result = findBestLink(links, 0, 'backward');
        expect(result?.pano).toBe('south');
    });

    it('finds left link correctly', () => {
        const result = findBestLink(links, 0, 'left');
        expect(result?.pano).toBe('west');
    });

    it('finds right link correctly', () => {
        const result = findBestLink(links, 0, 'right');
        expect(result?.pano).toBe('east');
    });

    it('returns null if no link is within 45 degrees', () => {
        const limitedLinks: google.maps.StreetViewLink[] = [
            { heading: 180, pano: 'south', description: '' },
        ];
        const result = findBestLink(limitedLinks, 0, 'forward');
        expect(result).toBeNull();
    });

    it('handles heading near 360/0 boundary', () => {
        const boundaryLinks: google.maps.StreetViewLink[] = [
            { heading: 355, pano: 'near-north', description: '' },
        ];
        const result = findBestLink(boundaryLinks, 0, 'forward');
        expect(result?.pano).toBe('near-north');
    });
});

describe('normalizeAngle', () => {
    it.each([
        [0, 0], [0.5, 0.5], [45, 45], [180, 180], [359.5, 359.5], [360, 0], [361, 1],
        [-1, 359], [-180, 180], [-359.5, 0.5], [-720.25, 359.75], [1080.75, 0.75],
    ])('normalizeAngle(%f) = %f', (input, expected) => {
        expect(normalizeAngle(input)).toBe(expected);
    });

    it('keeps f64 precision (no f32 round trip)', () => {
        expect(normalizeAngle(123.456789012345)).toBe(123.456789012345);
        expect(normalizeAngle(-0.1)).toBe(359.9);
    });
});

describe('signedAngleDiff (target, current) = target - current in [-180, 180)', () => {
    it.each([
        // [target, current, expected]
        [90, 0, 90],
        [0, 90, -90],
        [350, 10, -20],
        [10, 350, 20],
        [180, 0, -180],
        [0, 180, -180],
        [45, -45, 90],
        [45, 720, 45],
        [1, 359, 2],
        [-456.5, 123.25, 140.25],
        // A negative target - current + 180 needs the +360 correction.
        [0, 183, 177],
    ])('signedAngleDiff(%f, %f) = %f', (target, current, expected) => {
        expect(signedAngleDiff(target, current)).toBe(expected);
    });

    it('keeps f64 precision (no f32 round trip)', () => {
        expect(signedAngleDiff(10.123456789, 0)).toBe(10.123456789);
        // A tiny heading delta survives; through f32 it was lost at 300°.
        expect(signedAngleDiff(300.0000001, 300)).toBeCloseTo(1e-7, 12);
    });

    it('stays in [-180, 180) across a sweep', () => {
        for (let t = -1000; t <= 1000; t += 7.25) {
            for (let c = -1000; c <= 1000; c += 13.5) {
                const d = signedAngleDiff(t, c);
                expect(d).toBeGreaterThanOrEqual(-180);
                expect(d).toBeLessThan(180);
                expect(normalizeAngle(c + d)).toBeCloseTo(normalizeAngle(t), 9);
            }
        }
    });
});

describe('haversineMeters', () => {
    it.each([
        [40.7128, -74.006, 51.5074, -0.1278, 5570222.179737957],
        [0, 0, 0, 1, 111194.92664455874],
        [-33.8688, 151.2093, 35.6762, 139.6503, 7825818.616516158],
        [89.9, 0, -89.9, 180, 20015086.79602057],
    ])('(%f, %f) -> (%f, %f) = %f m', (lat1, lon1, lat2, lon2, expected) => {
        expect(haversineMeters(lat1, lon1, lat2, lon2)).toBeCloseTo(expected, 6);
    });

    it('is exactly 0 for identical points and symmetric', () => {
        expect(haversineMeters(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
        expect(haversineMeters(40.7, -74, 51.5, -0.1)).toBe(haversineMeters(51.5, -0.1, 40.7, -74));
    });

    it('agrees with the WASM batch kernel per segment within 1e-6 m', () => {
        const n = 400;
        const pts = new Float64Array(n * 2);
        for (let i = 0; i < n; i++) {
            pts[i * 2] = -80 + ((i * 37) % 160) + i * 1e-3;
            pts[i * 2 + 1] = -179 + ((i * 53) % 358) + i * 1e-4;
        }
        const segs = new Float64Array(n - 1);
        requireWasm().batchHaversine(pts, segs);
        for (let i = 0; i < n - 1; i++) {
            const d = haversineMeters(pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!);
            expect(Math.abs(d - segs[i]!)).toBeLessThanOrEqual(1e-6);
        }
    });

    it('haversineDistance scales it per unit', () => {
        const m = haversineMeters(40.7128, -74.006, 51.5074, -0.1278);
        expect(haversineDistance(40.7128, -74.006, 51.5074, -0.1278)).toBe(m * (6371 / 6371000));
        expect(haversineDistance(40.7128, -74.006, 51.5074, -0.1278, 'mi')).toBe(m * (3959 / 6371000));
    });
});

describe('one-line maths before the WASM binary loads', () => {
    it('normalizeAngle / signedAngleDiff / haversine never touch requireWasm', () => {
        const mod = requireWasm();
        _resetWasmModule();
        try {
            expect(() => requireWasm()).toThrow(/not loaded/);
            expect(normalizeAngle(-90)).toBe(270);
            expect(signedAngleDiff(10, 350)).toBe(20);
            expect(haversineMeters(0, 0, 0, 1)).toBeGreaterThan(0);
            expect(haversineDistance(0, 0, 0, 1)).toBeGreaterThan(0);
        } finally {
            _installWasmModule(mod);
        }
    });
});
