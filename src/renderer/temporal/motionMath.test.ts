import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_DEPTH_PARAMS_FLOAT_COUNT, SceneDepthParamIndex as D } from '../depth/sceneDepthBinding';
import { displayedHorizontalFov, type PovSample, type Vec2 } from '../reproject/reprojectMath';
import {
    MOTION_MODE_CODE,
    MOTION_UNIFORM_FLOAT_COUNT,
    MotionUniformIndex as I,
    TemporalHistoryTracker,
    cameraPrevUV,
    dollyPrevUV,
    frameTangents,
    heldLookDelta,
    motionAt,
    packMotionUniforms,
    type TemporalFrameInput,
} from './motionMath';

const DEG = Math.PI / 180;
const W = 1280;
const H = 720;
const NO_DEPTH = new Float32Array(SCENE_DEPTH_PARAMS_FLOAT_COUNT);

const pov = (heading: number, pitch: number, zoom = 1): PovSample => ({ heading, pitch, zoom });

function uniforms(prev: PovSample, current: PovSample, over: Partial<Parameters<typeof packMotionUniforms>[0]> = {}) {
    return packMotionUniforms({ mode: 'camera', prev, current, width: W, height: H, ...over });
}

/** Project a world direction into a camera `Ry(heading)·Rx(pitch)` at `zoom` — the forward model. */
function project(dir: [number, number, number], camera: PovSample): Vec2 {
    const [tanH, tanV] = frameTangents(camera.zoom, W, H);
    const [x, y, z] = dir;
    const h = -camera.heading * DEG;
    const xa = x * Math.cos(h) + z * Math.sin(h);
    const za = -x * Math.sin(h) + z * Math.cos(h);
    const p = -camera.pitch * DEG;
    const yb = y * Math.cos(p) + za * Math.sin(p);
    const zb = -y * Math.sin(p) + za * Math.cos(p);
    return [(xa / zb / tanH + 1) / 2, (1 - yb / zb / tanV) / 2];
}

/** A world direction the camera sees at `uv` — the inverse of `project`. */
function unproject(uv: Vec2, camera: PovSample): [number, number, number] {
    const [tanH, tanV] = frameTangents(camera.zoom, W, H);
    const ex = (uv[0] * 2 - 1) * tanH;
    const ey = (1 - uv[1] * 2) * tanV;
    const p = camera.pitch * DEG;
    const y = ey * Math.cos(p) + Math.sin(p);
    const za = -ey * Math.sin(p) + Math.cos(p);
    const h = camera.heading * DEG;
    return [ex * Math.cos(h) + za * Math.sin(h), y, -ex * Math.sin(h) + za * Math.cos(h)];
}

/** Expected motion (pixels) of the world point the current camera shows at `uv`. */
function expectedMotion(uv: Vec2, prev: PovSample, current: PovSample): Vec2 {
    const before = project(unproject(uv, current), prev);
    return [(uv[0] - before[0]) * W, (uv[1] - before[1]) * H];
}

const SAMPLE_UVS: Vec2[] = [[0.5, 0.5], [0.1, 0.9], [0.83, 0.2], [0.02, 0.03], [0.97, 0.6]];

describe('camera motion', () => {
    it('is zero when nothing moved, at any pitch and zoom', () => {
        for (const p of [pov(30, 0), pov(359, 22, 1.7), pov(120, -15, 2.4)]) {
            const u = uniforms(p, p);
            for (const uv of SAMPLE_UVS) {
                const m = motionAt(uv, u, NO_DEPTH);
                // The rotation is packed as f32: a hundredth of a millipixel of rounding.
                expect(Math.abs(m[0])).toBeLessThan(1e-3);
                expect(Math.abs(m[1])).toBeLessThan(1e-3);
            }
        }
    });

    it('turning right moves the image left (motion = current − previous, pixels)', () => {
        const m = motionAt([0.5, 0.5], uniforms(pov(10, 0), pov(12, 0)), NO_DEPTH);
        expect(m[0]).toBeLessThan(0);
        expect(Math.abs(m[1])).toBeLessThan(1e-6);
        // At the centre, a yaw of δ moves the image by tan(δ)/tan(hfov/2) half-widths.
        const [tanH] = frameTangents(1, W, H);
        expect(m[0]).toBeCloseTo((-Math.tan(2 * DEG) / tanH) * (W / 2), 4);
    });

    it('looking up moves the image down', () => {
        const m = motionAt([0.5, 0.5], uniforms(pov(0, 0), pov(0, 3)), NO_DEPTH);
        expect(m[1]).toBeGreaterThan(0);
        expect(Math.abs(m[0])).toBeLessThan(1e-6);
    });

    it('is the exact rotation homography: yaw and pitch together, off level, across the seam', () => {
        const cases: Array<[PovSample, PovSample]> = [
            [pov(358, 12), pov(3, 15)],
            [pov(90, -20), pov(84, -11)],
            [pov(200, 35), pov(201.5, 34)],
        ];
        for (const [prev, current] of cases) {
            const u = uniforms(prev, current);
            for (const uv of SAMPLE_UVS) {
                const m = motionAt(uv, u, NO_DEPTH);
                const e = expectedMotion(uv, prev, current);
                expect(m[0]).toBeCloseTo(e[0], 2);
                expect(m[1]).toBeCloseTo(e[1], 2);
            }
        }
    });

    it('a zoom change within one Maps level is the FOV term: radial, zero at the centre', () => {
        const prev = pov(40, 5, 1.2);
        const current = pov(40, 5, 1.5);
        const u = uniforms(prev, current);
        const centre = motionAt([0.5, 0.5], u, NO_DEPTH);
        expect(Math.abs(centre[0])).toBeLessThan(1e-6);
        expect(Math.abs(centre[1])).toBeLessThan(1e-6);
        // Zooming in: a pixel right of centre showed something nearer the centre last frame.
        const right = motionAt([0.9, 0.5], u, NO_DEPTH);
        expect(right[0]).toBeGreaterThan(0);
        for (const uv of SAMPLE_UVS) {
            const m = motionAt(uv, u, NO_DEPTH);
            const e = expectedMotion(uv, prev, current);
            expect(m[0]).toBeCloseTo(e[0], 2);
            expect(m[1]).toBeCloseTo(e[1], 2);
        }
    });

    it('cameraPrevUV is where the previous frame saw the same ray', () => {
        const prev = pov(15, 8, 1.1);
        const current = pov(19, 6, 1.3);
        const u = uniforms(prev, current);
        for (const uv of SAMPLE_UVS) {
            const got = cameraPrevUV(uv, u);
            const want = project(unproject(uv, current), prev);
            expect(got[0]).toBeCloseTo(want[0], 5);
            expect(got[1]).toBeCloseTo(want[1], 5);
        }
    });

    it('mode none is a zero field whatever the cameras did', () => {
        const u = uniforms(pov(0, 0), pov(20, 10), { mode: 'none' });
        expect(u[I.mode]).toBe(MOTION_MODE_CODE.none);
        expect(motionAt([0.3, 0.7], u, NO_DEPTH)).toEqual([0, 0]);
    });
});

describe('release dolly motion', () => {
    function dollyDepth(over: Partial<Record<keyof typeof D, number>> = {}): Float32Array {
        const d = new Float32Array(SCENE_DEPTH_PARAMS_FLOAT_COUNT);
        d[D.blend] = 1;
        d[D.dolly] = 0.35;
        d[D.dollyLateral] = 0.04;
        d[D.foeY] = 0.45;
        d[D.zoom] = 1;
        for (const [k, v] of Object.entries(over)) d[D[k as keyof typeof D]] = v;
        return d;
    }

    /** `samplePrevForRelease`'s `src` at constant nearness — the forward model the dolly term inverts. */
    function snapshotPoint(screenUV: Vec2, t: number, near: number, d: Float32Array): Vec2 {
        const foe: Vec2 = [0.5, d[D.foeY]!];
        const scale = Math.max(1 + d[D.dolly]! * t * near, 0.5);
        return [
            foe[0] + (screenUV[0] - foe[0]) / scale + d[D.dollyLateral]! * t * near,
            foe[1] + (screenUV[1] - foe[1]) / scale,
        ];
    }

    it('is the identity with dolly 0 and dollyLateral 0, exactly (the crossfade release)', () => {
        const u = uniforms(pov(5, 0), pov(5, 0), { progress: 0.6, prevProgress: 0.5 });
        for (const uv of SAMPLE_UVS) {
            expect(dollyPrevUV(uv, u, NO_DEPTH, () => 0.2)).toBe(uv);
        }
    });

    it('points at where last frame drew the same snapshot point', () => {
        const d = dollyDepth();
        const u = uniforms(pov(5, 0), pov(5, 0), { progress: 0.6, prevProgress: 0.5 });
        const depth = 0.3; // constant map → constant nearness 0.7 away from the edges
        for (const uv of [[0.5, 0.6], [0.3, 0.7], [0.7, 0.35]] as Vec2[]) {
            const m = motionAt(uv, u, d, () => depth);
            const prev: Vec2 = [uv[0] - m[0] / W, uv[1] - m[1] / H];
            const now = snapshotPoint(uv, 0.6, 1 - depth, d);
            const then = snapshotPoint(prev, 0.5, 1 - depth, d);
            expect(then[0]).toBeCloseTo(now[0], 6);
            expect(then[1]).toBeCloseTo(now[1], 6);
        }
    });

    it('pushing in moves near pixels outward from the focus of expansion; the skyline stays', () => {
        const d = dollyDepth({ dollyLateral: 0 });
        const u = uniforms(pov(5, 0), pov(5, 0), { progress: 0.6, prevProgress: 0.5 });
        const near = motionAt([0.8, 0.8], u, d, () => 0);
        expect(near[0]).toBeGreaterThan(0);
        expect(near[1]).toBeGreaterThan(0);
        const sky = motionAt([0.8, 0.8], u, d, () => 1);
        expect(Math.abs(sky[0])).toBeLessThan(1e-9);
        expect(Math.abs(sky[1])).toBeLessThan(1e-9);
    });

    it('reads nearness through the hold look-around and the depth map pose', () => {
        const d = dollyDepth({ heldShiftX: 0.1, heldShiftY: -0.05, zoom: 1.5 });
        const look = heldLookDelta({ x: 0.52, y: 0.5 }, { x: 0.5, y: 0.48 }, 1.25);
        const u = uniforms(pov(5, 0), pov(5, 0, 1.25), { progress: 0.4, prevProgress: 0.3, look });
        const seen: Vec2[] = [];
        dollyPrevUV([0.6, 0.6], u, d, (duv) => {
            seen.push(duv);
            return 0.5;
        });
        // Screen → canvas (/ zoom), minus the look-around, → depth-map screen (· map zoom), minus held shift.
        const uv = (0.6 - 0.5) / 1.25 + 0.5;
        expect(seen).toHaveLength(1);
        expect(seen[0]![0]).toBeCloseTo((uv - look[0] - 0.5) * 1.5 + 0.5 - 0.1, 6);
        expect(seen[0]![1]).toBeCloseTo((uv - look[1] - 0.5) * 1.5 + 0.5 + 0.05, 6);
    });
});

describe('heldLookDelta — samplePrevWithLookAround', () => {
    it('wraps across the pan seam and scales by 4 / zoom and 2.8 / zoom', () => {
        const [x, y] = heldLookDelta({ x: 0.01, y: 0.55 }, { x: 0.99, y: 0.5 }, 2);
        expect(x).toBeCloseTo(0.02 * 2, 10);
        expect(y).toBeCloseTo(0.05 * 1.4, 10);
    });
});

describe('packMotionUniforms', () => {
    it('packs the previous FOV as the source and the current one as the output frustum', () => {
        const u = uniforms(pov(0, 0, 1.2), pov(0, 0, 1.8));
        const [prevH, prevV] = frameTangents(1.2, W, H);
        const [curH, curV] = frameTangents(1.8, W, H);
        expect(u[I.prevTanHalfH]).toBeCloseTo(prevH, 6);
        expect(u[I.prevTanHalfV]).toBeCloseTo(prevV, 6);
        expect(u[I.outHalfX]).toBeCloseTo(curH, 6);
        expect(u[I.outHalfY]).toBeCloseTo(curV, 6);
        expect([u[I.width], u[I.height], u[I.zoom]]).toEqual([W, H, Math.fround(1.8)]);
        expect(curH).toBeCloseTo(Math.tan((displayedHorizontalFov(1.8) * DEG) / 2), 12);
    });

    it('reuses the array it is given', () => {
        const out = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT).fill(9);
        expect(packMotionUniforms({ mode: 'none', prev: pov(0, 0), current: pov(0, 0), width: 4, height: 2 }, out)).toBe(out);
        expect(out[10]).toBe(0);
    });
});

describe('MotionUniforms — one layout in TS and motion.wgsl', () => {
    it('every index lands on the WGSL member it names', () => {
        const source = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', 'motion.wgsl'), 'utf8');
        const start = source.indexOf('struct MotionUniforms');
        const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('};', start));
        const sizes: Record<string, [number, number]> = { 'f32': [1, 1], 'vec2<f32>': [2, 2], 'vec4<f32>': [4, 4] };
        const offsets = new Map<string, number>();
        let at = 0;
        for (const line of body.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)) {
            const m = /^(\w+)\s*:\s*(f32|vec2<f32>|vec4<f32>),?$/.exec(line);
            if (!m) throw new Error(`unexpected MotionUniforms member: ${line}`);
            const [size, align] = sizes[m[2]!]!;
            at = Math.ceil(at / align) * align;
            offsets.set(m[1]!, at);
            at += size;
        }
        expect(at).toBe(MOTION_UNIFORM_FLOAT_COUNT);
        for (const name of ['mode', 'prevTanHalfH', 'prevTanHalfV', 'width', 'height', 'zoom', 'progress', 'prevProgress'] as const) {
            expect(offsets.get(name), name).toBe(I[name]);
        }
        expect(offsets.get('look')).toBe(I.lookX);
        expect(I.lookY).toBe(I.lookX + 1);
        expect(offsets.get('outFrustum')).toBe(I.outCentreX);
        expect([I.outCentreY, I.outHalfX, I.outHalfY]).toEqual([I.outCentreX + 1, I.outCentreX + 2, I.outCentreX + 3]);
        expect([offsets.get('rotX'), offsets.get('rotY'), offsets.get('rotZ')]).toEqual([I.rotation, I.rotation + 4, I.rotation + 8]);
    });

    it('declares the shared SceneDepthParams struct field for field', () => {
        const read = (file: string) => {
            const source = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', file), 'utf8');
            const start = source.indexOf('struct SceneDepthParams');
            return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start))
                .split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
                .map((l) => l.replace(/\s+/g, ''));
        };
        expect(read('motion.wgsl')).toEqual(read('streetview.wgsl'));
    });

    it('mirrors streetview.wgsl: the dolly early return and the nearness lookup', () => {
        const motion = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', 'motion.wgsl'), 'utf8');
        expect(motion).toContain('if (depthParams.dolly == 0.0 && depthParams.dollyLateral == 0.0) {\n        return screenUV;');
        expect(motion).toContain('let scale = max(1.0 + depthParams.dolly * t * near, 0.5);');
        expect(motion).toContain('let coverage = smoothstep(0.0, 0.04, edge);');
    });
});

describe('TemporalHistoryTracker', () => {
    const base: TemporalFrameInput = {
        pov: pov(10, 0, 1),
        width: W,
        height: H,
        holdActive: false,
        panoEpoch: 0,
        transitioning: false,
        historicalWipe: false,
    };

    function run(frames: Array<Partial<TemporalFrameInput>>) {
        const tracker = new TemporalHistoryTracker();
        return frames.map((f) => tracker.step({ ...base, ...f }));
    }

    it('has neither motion nor history on the first frame, both on a steady pan', () => {
        const [a, b, c] = run([{}, { pov: pov(11, 0) }, { pov: pov(12, 0.5) }]);
        expect(a).toMatchObject({ motion: false, motionReset: 'first-frame', history: false });
        expect(b).toMatchObject({ motion: true, history: true, historyReset: null });
        expect(b!.prev!.pov).toEqual(pov(10, 0, 1));
        expect(c!.prev!.pov).toEqual(pov(11, 0, 1));
    });

    it('resets both on a resize (a render-scale change)', () => {
        const [, b, c] = run([{}, { width: 960, height: 540 }, { width: 960, height: 540 }]);
        expect(b).toMatchObject({ motion: false, motionReset: 'resize' });
        expect(c).toMatchObject({ motion: true, history: true });
    });

    it('a hop: the hold, its release and the first clean frame after it all drop history', () => {
        const frames = run([
            {},                                                        // steady
            { holdActive: true },                                      // hold: frozen frame
            { holdActive: true },
            { panoEpoch: 1, transitioning: true, releaseProgress: 0.1 }, // release starts on the new pano
            { panoEpoch: 1, transitioning: true, releaseProgress: 0.5 },
            { panoEpoch: 1 },                                          // crossfade over: last frame was dirty
            { panoEpoch: 1 },                                          // first frame with a clean history
        ]);
        expect(frames.map((f) => [f.motion, f.history])).toEqual([
            [false, false],
            [false, false],
            [false, false],
            [false, false],
            [true, false],
            [true, false],
            [true, true],
        ]);
        expect(frames.map((f) => f.historyReset)).toEqual([
            'first-frame', 'hold', 'hold', 'hold', 'transition', 'dirty-history', null,
        ]);
        // A release has motion for the dolly, against last frame's progress.
        expect(frames[4]!.prev!.releaseProgress).toBe(0.1);
    });

    it('a pano change without a hold resets in the same frame', () => {
        const [, b] = run([{}, { panoEpoch: 3 }]);
        expect(b).toMatchObject({ motion: false, motionReset: 'pano', history: false });
    });

    it('a historical wipe keeps motion and drops history, and the frame after it too', () => {
        const [, b, c, d] = run([{}, { historicalWipe: true }, {}, {}]);
        expect(b).toMatchObject({ motion: true, history: false, historyReset: 'historical-wipe' });
        expect(c).toMatchObject({ motion: true, history: false, historyReset: 'dirty-history' });
        expect(d).toMatchObject({ history: true });
    });

    it('a Maps zoom step resets; a zoom within one level does not', () => {
        const [, b, c] = run([{ pov: pov(0, 0, 1.4) }, { pov: pov(0, 0, 1.9) }, { pov: pov(0, 0, 2.05) }]);
        expect(b).toMatchObject({ motion: true, history: true });
        expect(c).toMatchObject({ motion: false, motionReset: 'maps-zoom' });
    });

    it('a turn wider than the view is a cut', () => {
        const fov = displayedHorizontalFov(1);
        const [, b, c] = run([{ pov: pov(0, 0) }, { pov: pov(fov * 0.9, 0) }, { pov: pov(fov * 0.9 + fov, 0) }]);
        expect(b).toMatchObject({ motion: true });
        expect(c).toMatchObject({ motion: false, motionReset: 'cut' });
    });

    it('reset() forgets the last frame', () => {
        const tracker = new TemporalHistoryTracker();
        tracker.step(base);
        tracker.reset();
        expect(tracker.step(base)).toMatchObject({ motion: false, motionReset: 'first-frame' });
    });
});
