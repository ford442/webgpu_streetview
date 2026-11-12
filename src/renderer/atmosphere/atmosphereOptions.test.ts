import { describe, expect, it } from 'vitest';
import {
    SUN_REBUILD_THRESHOLD_RAD,
    atmosphereRebuild,
    resolveAtmosphereOptions,
    type AtmosphereBuiltState,
} from './atmosphereOptions';

const deg = (d: number) => (d * Math.PI) / 180;

const state = (patch: Partial<AtmosphereBuiltState> = {}): AtmosphereBuiltState => ({
    sunAltitude: deg(10),
    visibilityM: null,
    groundAlbedo: 0.3,
    observerAltitudeM: 0,
    ...patch,
});

describe('resolveAtmosphereOptions', () => {
    it('is absent at Low/Medium even when opted in', () => {
        for (const quality of ['low', 'medium'] as const) {
            expect(resolveAtmosphereOptions({ quality, optedIn: true, sunAltitude: 0.2, visibilityM: 5000 }).enabled)
                .toBe(false);
        }
    });

    it('is opt-in at High/Ultra', () => {
        for (const quality of ['high', 'ultra'] as const) {
            expect(resolveAtmosphereOptions({ quality, optedIn: false, sunAltitude: 0.2, visibilityM: null }).enabled)
                .toBe(false);
            expect(resolveAtmosphereOptions({ quality, optedIn: true, sunAltitude: 0.2, visibilityM: null }).enabled)
                .toBe(true);
        }
    });

    it('treats a missing, zero or non-finite visibility as unknown, and a NaN sun as the horizon', () => {
        for (const visibilityM of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(resolveAtmosphereOptions({ quality: 'high', optedIn: true, sunAltitude: 0, visibilityM }).visibilityM)
                .toBeNull();
        }
        expect(resolveAtmosphereOptions({ quality: 'high', optedIn: true, sunAltitude: 0, visibilityM: 8000 }).visibilityM)
            .toBe(8000);
        expect(resolveAtmosphereOptions({ quality: 'high', optedIn: true, sunAltitude: Number.NaN, visibilityM: null })
            .sunAltitude).toBe(0);
    });

    it('writes into `out` without allocating', () => {
        const out = resolveAtmosphereOptions({ quality: 'high', optedIn: true, sunAltitude: 0.1, visibilityM: null });
        const again = resolveAtmosphereOptions({ quality: 'ultra', optedIn: true, sunAltitude: 0.3, visibilityM: 1000 }, out);
        expect(again).toBe(out);
        expect(out.sunAltitude).toBe(0.3);
    });
});

describe('atmosphereRebuild', () => {
    it('builds everything the first time', () => {
        expect(atmosphereRebuild(null, state())).toBe('medium');
    });

    it('does nothing for a still sun and an unchanged medium (not per frame)', () => {
        expect(atmosphereRebuild(state(), state())).toBe('none');
    });

    it('rebuilds sky view + aerial only once the sun has moved more than 0.1°', () => {
        expect(SUN_REBUILD_THRESHOLD_RAD).toBeCloseTo(deg(0.1), 12);
        expect(atmosphereRebuild(state(), state({ sunAltitude: deg(10.05) }))).toBe('none');
        expect(atmosphereRebuild(state(), state({ sunAltitude: deg(10.2) }))).toBe('sun');
        expect(atmosphereRebuild(state(), state({ sunAltitude: deg(9.8) }))).toBe('sun');
    });

    it('rebuilds everything when the medium changes, whatever the sun did', () => {
        expect(atmosphereRebuild(state(), state({ visibilityM: 5000 }))).toBe('medium');
        expect(atmosphereRebuild(state({ visibilityM: 5000 }), state({ visibilityM: null }))).toBe('medium');
        expect(atmosphereRebuild(state(), state({ groundAlbedo: 0.1 }))).toBe('medium');
        expect(atmosphereRebuild(state(), state({ observerAltitudeM: 300, sunAltitude: deg(30) }))).toBe('medium');
    });
});
