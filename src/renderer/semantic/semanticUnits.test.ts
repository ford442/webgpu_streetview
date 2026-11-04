import { describe, expect, it } from 'vitest';
import manifest from './semanticModel.manifest.json';
import { decodeSemanticProbs } from './semanticDecode';
import { skyLowerEdge } from './semanticHorizon';
import { packSceneSemanticParams, SEMANTIC_EFFECTS_DEFAULT } from './semanticParams';
import { resolveSceneSemanticOptions } from './sceneSemanticOptions';
import { SceneSemanticParamIndex as I } from './sceneSemanticBinding';
import { SEMANTIC_CLASS_COUNT, SEMANTIC_CLASS_NAMES, SEMANTIC_CLASS_SOURCES, SemanticClass } from './semanticClasses';
import { semanticModelFile, SEMANTIC_MODEL_CACHE_NAME } from './semanticModel';
import { resolveHorizonFrame, HORIZON_IDLE, HORIZON_OFF, predictedHorizonY } from '../gpuChores/horizonEstimate';

describe('semantic classes', () => {
    it('the manifest table is the SemanticClass order, and every source label is used once', () => {
        expect(SEMANTIC_CLASS_NAMES).toEqual(Object.keys(SemanticClass));
        expect(SEMANTIC_CLASS_COUNT).toBe(manifest.classes.length);
        const used = SEMANTIC_CLASS_SOURCES.flat();
        expect([...used].sort()).toEqual([...manifest.sourceClasses].sort());
        expect(new Set(used).size).toBe(used.length);
    });

    it('licence is MIT and the served file is pinned (rebuild output, not the archive)', () => {
        expect(manifest.license).toBe('MIT');
        expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(manifest.source.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(manifest.bytes).toBeLessThanOrEqual(15e6);
        expect(semanticModelFile('http://h/app/').url).toBe('http://h/app/models/semantic/ddrnet23-slim-street7.onnx');
        expect(SEMANTIC_MODEL_CACHE_NAME.startsWith('streetview-semantic-model-')).toBe(true);
    });
});

describe('decodeSemanticProbs', () => {
    it('takes the per-pixel argmax as id + 1 and its probability, with a histogram', () => {
        // 3 classes × 2×1 pixels: pixel 0 → class 2 (0.7), pixel 1 → class 0 (0.5).
        const probs = new Float32Array([0.2, 0.5, 0.1, 0.25, 0.7, 0.25]);
        const out = decodeSemanticProbs(probs, 3, 2, 1);
        expect([...out.texels]).toEqual([3, Math.round(Math.fround(0.7) * 255), 1, Math.round(0.5 * 255)]);
        expect([...out.histogram]).toEqual([0.5, 0, 0.5]);
        expect(out.meanConfidence).toBeCloseTo(0.6, 5);
    });

    it('measures the photo sky colour over the pixels labelled sky (zeros without a frame or sky)', () => {
        // 2×1: pixel 0 sky (class 0), pixel 1 class 1.
        const probs = new Float32Array([0.9, 0.1, 0.1, 0.9]);
        const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]);
        const rgbaBlue = new Uint8Array([51, 102, 255, 255, 0, 0, 0, 255]);
        expect(decodeSemanticProbs(probs, 2, 2, 1, rgbaBlue).skyColor.map((v) => +v.toFixed(5))).toEqual([0.2, 0.4, 1]);
        expect(decodeSemanticProbs(probs, 2, 2, 1, rgba).skyColor).toEqual([1, 1, 1]);
        expect(decodeSemanticProbs(probs, 2, 2, 1).skyColor).toEqual([0, 0, 0]);
        const noSky = new Float32Array([0.1, 0.1, 0.9, 0.9]);
        expect(decodeSemanticProbs(noSky, 2, 2, 1, rgba).skyColor).toEqual([0, 0, 0]);
    });

    it('NaN logits decode to class 0 at probability 0 instead of garbage', () => {
        const out = decodeSemanticProbs(new Float32Array([NaN, NaN]), 2, 1, 1);
        expect([...out.texels]).toEqual([1, 0]);
    });

    it('rejects a short buffer', () => {
        expect(() => decodeSemanticProbs(new Float32Array(5), 3, 2, 1)).toThrow(/expected 3 × 2 × 1/);
    });
});

function map(width: number, height: number, cls: (x: number, y: number) => number): Uint8Array {
    const t = new Uint8Array(width * height * 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) t[(y * width + x) * 2] = cls(x, y) + 1;
    return t;
}

describe('skyLowerEdge', () => {
    it('is the median per-column end of the sky run that starts at the top', () => {
        // Sky down to row 10 on the left half, row 20 on the right half (of 50 rows).
        const t = map(40, 50, (x, y) => (y < (x < 20 ? 10 : 20) ? SemanticClass.sky : SemanticClass.building));
        const edge = skyLowerEdge(t, 40, 50)!;
        expect(edge.coverage).toBe(1);
        expect(edge.y).toBeCloseTo((10 / 50 + 20 / 50) / 2, 5);
    });

    it('bridges a thin wire across the sky, but not a building', () => {
        const t = map(10, 40, (_x, y) => (y === 5 ? SemanticClass.building : y < 15 ? SemanticClass.sky : SemanticClass.road));
        expect(skyLowerEdge(t, 10, 40)!.y).toBeCloseTo(15 / 40, 5);
    });

    it('needs sky in enough columns, starting near the top', () => {
        const canopy = map(10, 40, (x, y) => (x === 0 && y < 10 ? SemanticClass.sky : SemanticClass.vegetation));
        expect(skyLowerEdge(canopy, 10, 40)).toBeNull();
        const lowSky = map(10, 40, (_x, y) => (y > 20 && y < 30 ? SemanticClass.sky : SemanticClass.road));
        expect(skyLowerEdge(lowSky, 10, 40)).toBeNull();
    });
});

describe('packSceneSemanticParams', () => {
    const view = { panX: 0.3, panY: 0.55, zoom: 1 };
    const map0 = { panX: 0.25, panY: 0.5, zoom: 1, epoch: 0 };

    it('is all zero without a map, at blend 0, or at confidence 0', () => {
        for (const input of [
            { blend: 1, confidence: 1, map: null },
            { blend: 0, confidence: 1, map: map0 },
            { blend: 1, confidence: 0, map: map0 },
        ]) {
            const out = packSceneSemanticParams({ ...input, view, effects: SEMANTIC_EFFECTS_DEFAULT, reducedMotion: true, skyColor: [0.3, 0.5, 0.9] });
            expect([...out].every((v) => v === 0)).toBe(true);
        }
    });

    it('packs weight × trust, the look-around shift and the effect weights', () => {
        const out = packSceneSemanticParams({
            blend: 0.8, confidence: 0.5, view, map: map0, effects: { ...SEMANTIC_EFFECTS_DEFAULT, relight: 0.25 }, reducedMotion: true, skyColor: [0.3, 0.5, 0.9],
        });
        expect(out[I.blend]).toBeCloseTo(0.4, 6);
        expect(out[I.shiftX]).toBeGreaterThan(0);
        expect(out[I.shiftY]).toBeGreaterThan(0);
        expect(out[I.relight]).toBe(0.25);
        expect(out[I.stillness]).toBe(1);
        expect([out[I.skyR], out[I.skyG], out[I.skyB]].map((v) => +v!.toFixed(5))).toEqual([0.3, 0.5, 0.9]);
    });
});

describe('resolveSceneSemanticOptions', () => {
    it('needs the opt-in, scene depth and a non-zero preset weight', () => {
        const base = { quality: 'ultra' as const, optedIn: true, depthEnabled: true, reducedMotion: false };
        expect(resolveSceneSemanticOptions(base)).toMatchObject({ enabled: true, blend: 1 });
        expect(resolveSceneSemanticOptions({ ...base, depthEnabled: false }).enabled).toBe(false);
        expect(resolveSceneSemanticOptions({ ...base, optedIn: false }).enabled).toBe(false);
        expect(resolveSceneSemanticOptions({ ...base, quality: 'medium' })).toMatchObject({ enabled: false, blend: 0 });
        expect(resolveSceneSemanticOptions({ ...base, quality: 'high' })).toMatchObject({ enabled: true, blend: 0.8 });
    });
});

describe('horizon from the sky edge (#352)', () => {
    const rows = Array.from({ length: 48 }, (_, i) => (i < 20 ? 0.9 : 0.2));
    const base = { weight: 0.7, holdActive: false, rows, rowsPitch: 0.5, rowsSeq: 1, livePitch: 0.5 };

    it('the sky edge replaces the luma rows while present', () => {
        const r = resolveHorizonFrame({ ...base, skyEdge: { y: 0.3, pitch: 0.5, seq: 1 } }, HORIZON_IDLE);
        expect(r.uniforms.estimateY).toBeCloseTo(0.3, 6);
        expect(r.state.lastSeq).toBe(0); // rows not consumed
        const luma = resolveHorizonFrame(base, HORIZON_IDLE);
        expect(luma.uniforms.estimateY).toBeCloseTo(20 / 48, 6);
    });

    it('integrates one edge once and re-projects it with the live pitch', () => {
        const first = resolveHorizonFrame({ ...base, skyEdge: { y: 0.3, pitch: 0.5, seq: 1 } }, HORIZON_IDLE);
        const again = resolveHorizonFrame({ ...base, livePitch: 0.6, skyEdge: { y: 0.3, pitch: 0.5, seq: 1 } }, first.state);
        expect(again.state.bias).toBe(first.state.bias);
        expect(again.uniforms.estimateY).toBeCloseTo(predictedHorizonY(0.6) + (0.3 - 0.5), 6);
    });

    it('weight 0 stays HORIZON_OFF (bit-exact pitch-only horizon)', () => {
        const r = resolveHorizonFrame({ ...base, weight: 0, skyEdge: { y: 0.3, pitch: 0.5, seq: 1 } }, HORIZON_IDLE);
        expect(r.uniforms).toBe(HORIZON_OFF);
    });

    it('a hold never consumes an edge', () => {
        const r = resolveHorizonFrame({ ...base, holdActive: true, skyEdge: { y: 0.3, pitch: 0.5, seq: 1 } }, HORIZON_IDLE);
        expect(r.uniforms).toBe(HORIZON_OFF);
    });
});
