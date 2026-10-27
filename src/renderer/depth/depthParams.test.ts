import { describe, expect, it } from 'vitest';
import {
    depthConfidenceTarget,
    LOOK_SCALE_H,
    LOOK_SCALE_V,
    packSceneDepthParams,
    RELEASE_DOLLY,
    RELEASE_DOLLY_LATERAL,
    releaseDollyScale,
    stepDepthConfidence,
    travelRelativeToView,
    XR_RELEASE_DOLLY_SCALE,
    type DepthParamsInput,
} from './depthParams';
import { SceneDepthParamIndex as I } from './sceneDepthBinding';

const view = { panX: 0.3, panY: 0.5, zoom: 1 };
const map = { panX: 0.3, panY: 0.5, zoom: 1, epoch: 4 };

function input(patch: Partial<DepthParamsInput> = {}): DepthParamsInput {
    return { blend: 0.8, confidence: 1, dollyScale: 1, view, map, hold: null, ...patch };
}

describe('scene-depth params', () => {
    it('no map → all zero, exactly the fallback block (blend 0 = the proxy, dolly 0 = the crossfade)', () => {
        expect(Array.from(packSceneDepthParams(input({ map: null })))).toEqual(new Array(12).fill(0));
    });

    it('blend is the preset weight times confidence', () => {
        expect(packSceneDepthParams(input({ blend: 0.6, confidence: 0.5 }))[I.blend]).toBeCloseTo(0.3, 6);
        expect(packSceneDepthParams(input({ blend: 0 }))[I.blend]).toBe(0);
    });

    it('shifts the map by the look-around since inference, with the hold-pause scale, across the seam', () => {
        const p = packSceneDepthParams(input({ view: { panX: 0.01, panY: 0.55, zoom: 1 }, map: { ...map, panX: 0.99 } }));
        expect(p[I.shiftX]).toBeCloseTo(0.02 * LOOK_SCALE_H, 6);
        expect(p[I.shiftY]).toBeCloseTo(0.05 * LOOK_SCALE_V, 6);
    });

    it('dollies only a hop with a travel heading, from the map of the pano being left', () => {
        const hold = { capturePanX: 0.3, capturePanY: 0.5, epoch: 4, travel: { forward: 1, lateral: 0 } };
        const p = packSceneDepthParams(input({ hold }));
        expect(p[I.dolly]).toBeCloseTo(RELEASE_DOLLY, 6);
        expect(p[I.dollyLateral]).toBe(0);
        expect(p[I.foeY]).toBeCloseTo(0.5, 6);

        // A teleport: no travel heading → plain crossfade.
        expect(packSceneDepthParams(input({ hold: { ...hold, travel: null } }))[I.dolly]).toBe(0);
        // The map belongs to another pano: never warp the held frame with it.
        expect(packSceneDepthParams(input({ hold: { ...hold, epoch: 3 } }))[I.dolly]).toBe(0);
        // Reduced motion.
        expect(packSceneDepthParams(input({ hold, dollyScale: 0 }))[I.dolly]).toBe(0);
        // Scene depth off.
        expect(packSceneDepthParams(input({ hold, blend: 0 }))[I.dolly]).toBe(0);
    });

    it('a step backward pulls the frame back; a side-step slides near pixels', () => {
        const back = travelRelativeToView(180, 0);
        const right = travelRelativeToView(90, 0);
        const hold = { capturePanX: 0.3, capturePanY: 0.5, epoch: 4, travel: back };
        expect(packSceneDepthParams(input({ hold }))[I.dolly]).toBeCloseTo(-RELEASE_DOLLY, 6);
        const side = packSceneDepthParams(input({ hold: { ...hold, travel: right } }));
        expect(side[I.dolly]).toBeCloseTo(0, 6);
        expect(side[I.dollyLateral]).toBeCloseTo(RELEASE_DOLLY_LATERAL, 6);
    });
});

describe('depth confidence', () => {
    it('trusts only a map of this pano at this zoom', () => {
        expect(depthConfidenceTarget(map, 4, 1)).toBe(1);
        expect(depthConfidenceTarget(map, 5, 1)).toBe(0);
        expect(depthConfidenceTarget(map, 4, 1.5)).toBe(0);
        expect(depthConfidenceTarget(null, 4, 1)).toBe(0);
    });

    it('drops at once for a new pano, eases otherwise', () => {
        expect(stepDepthConfidence(1, 0, 16, true)).toBe(0);
        const eased = stepDepthConfidence(1, 0, 16, false);
        expect(eased).toBeGreaterThan(0.8);
        expect(eased).toBeLessThan(1);
        let c = 0;
        for (let i = 0; i < 60; i++) c = stepDepthConfidence(c, 1, 16, false);
        expect(c).toBe(1);
    });
});

describe('release dolly scale', () => {
    it('is off under reduced motion, capped in a headset (#331), full otherwise', () => {
        expect(releaseDollyScale({ reducedMotion: true, xr: true })).toBe(0);
        expect(releaseDollyScale({ reducedMotion: false, xr: true })).toBe(XR_RELEASE_DOLLY_SCALE);
        expect(XR_RELEASE_DOLLY_SCALE).toBeLessThan(1);
        expect(releaseDollyScale({ reducedMotion: false, xr: false })).toBe(1);
    });
});
