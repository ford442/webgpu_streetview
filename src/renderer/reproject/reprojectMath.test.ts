import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_IPD_METRES,
    DEPTH_FAR_METRES,
    REPROJECT_MODE_CODE,
    REPROJECT_UNIFORM_FLOAT_COUNT,
    ReprojectUniformIndex as I,
    displayedHorizontalFov,
    eyeShift,
    eyeShiftRange,
    latchDelta,
    latchSourceUV,
    packReprojectUniforms,
    mulMat3,
    resolveReprojectMode,
    rotX,
    rotY,
    sourceFromEyeRotation,
    stereoSourceX,
    wrapHeadingDelta,
    type Vec2,
} from './reprojectMath';

const DEG = Math.PI / 180;

function uniforms(over: Partial<Parameters<typeof packReprojectUniforms>[0]> = {}) {
    return packReprojectUniforms({
        mode: 'latch',
        zoom: 1,
        outputWidth: 1600,
        outputHeight: 900,
        delta: { yawDeg: 0, pitchDeg: 0 },
        ...over,
    });
}

/** Project a world direction into a camera `Ry(heading)·Rx(pitch)` — the forward model the latch inverts. */
function project(dir: [number, number, number], headingDeg: number, pitchDeg: number, u: Float32Array): Vec2 {
    const [x, y, z] = dir;
    const h = -headingDeg * DEG;
    const xa = x * Math.cos(h) + z * Math.sin(h);
    const za = -x * Math.sin(h) + z * Math.cos(h);
    const p = -pitchDeg * DEG;
    const yb = y * Math.cos(p) + za * Math.sin(p);
    const zb = -y * Math.sin(p) + za * Math.cos(p);
    return [(xa / zb / u[I.tanHalfH]! + 1) / 2, (1 - yb / zb / u[I.tanHalfV]!) / 2];
}

describe('late latch delta', () => {
    it('takes the short way across the 0/360 seam', () => {
        expect(wrapHeadingDelta(350, 10)).toBe(20);
        expect(wrapHeadingDelta(10, 350)).toBe(-20);
        expect(wrapHeadingDelta(0, 180)).toBe(180);
    });

    it('measures the correction in degrees', () => {
        const d = latchDelta({ heading: 359, pitch: 0, zoom: 1 }, { heading: 2, pitch: 4, zoom: 1 });
        expect(d.yawDeg).toBe(3);
        expect(d.pitchDeg).toBe(4);
        expect(d.magnitudeDeg).toBeCloseTo(5, 10);
    });

    it('copies when there is nothing to latch, and always runs a stereo mode', () => {
        const still = latchDelta({ heading: 30, pitch: 5, zoom: 1 }, { heading: 30, pitch: 5, zoom: 1 });
        expect(resolveReprojectMode('off', still)).toBe('copy');
        expect(resolveReprojectMode('off', { ...still, yawDeg: 0.01 })).toBe('latch');
        expect(resolveReprojectMode('sbs', still)).toBe('sbs');
        expect(resolveReprojectMode('anaglyph', still)).toBe('anaglyph');
    });
});

describe('latchSourceUV', () => {
    it('is the identity when nothing moved', () => {
        const u = uniforms({ packedPitchDeg: 12 });
        for (const uv of [[0.5, 0.5], [0.1, 0.9], [0.83, 0.2]] as Vec2[]) {
            const out = latchSourceUV(uv, u);
            expect(out[0]).toBeCloseTo(uv[0], 6);
            expect(out[1]).toBeCloseTo(uv[1], 6);
        }
    });

    it('turning right shows what was right of centre; looking up shows what was above', () => {
        const right = latchSourceUV([0.5, 0.5], uniforms({ delta: { yawDeg: 3, pitchDeg: 0 } }));
        expect(right[0]).toBeGreaterThan(0.5);
        expect(right[1]).toBeCloseTo(0.5, 9);
        const up = latchSourceUV([0.5, 0.5], uniforms({ delta: { yawDeg: 0, pitchDeg: 3 } }));
        expect(up[1]).toBeLessThan(0.5);
        expect(up[0]).toBeCloseTo(0.5, 9);
    });

    it('lands every live pixel on the packed pixel of the same world direction, at any pitch', () => {
        const packed = { heading: 120, pitch: 25 };
        const live = { heading: 126.5, pitch: 21 };
        const u = uniforms({
            packedPitchDeg: packed.pitch,
            delta: { yawDeg: live.heading - packed.heading, pitchDeg: live.pitch - packed.pitch },
        });
        const dirs: [number, number, number][] = [
            [Math.sin(125 * DEG), 0.3, Math.cos(125 * DEG)],
            [Math.sin(140 * DEG), 0.6, Math.cos(140 * DEG)],
            [Math.sin(110 * DEG), 0.1, Math.cos(110 * DEG)],
        ];
        for (const dir of dirs) {
            const inLive = project(dir, live.heading, live.pitch, u);
            const inPacked = project(dir, packed.heading, packed.pitch, u);
            const got = latchSourceUV(inLive, u);
            expect(got[0]).toBeCloseTo(inPacked[0], 6);
            expect(got[1]).toBeCloseTo(inPacked[1], 6);
        }
    });

    it('a WebXR eye — rolled, with an asymmetric frustum — lands on the packed pixel of the same world direction', () => {
        const packed = { heading: 200, pitch: -5 };
        // An eye looking 8° right of and 3° above the packed POV, rolled 10°.
        const roll = 10 * DEG;
        const rotZ = [Math.cos(roll), Math.sin(roll), 0, -Math.sin(roll), Math.cos(roll), 0, 0, 0, 1];
        const worldFromEye = mulMat3(mulMat3(rotY(208 * DEG), rotX(-2 * DEG)), rotZ);
        const frustum = { left: -1.1, right: 0.85, down: -1.05, up: 0.9 };
        const u = uniforms({
            mode: 'eye',
            rotation: sourceFromEyeRotation(packed, worldFromEye),
            outFrustum: frustum,
        });
        for (const [ex, ey] of [[0, 0], [0.4, -0.3], [-0.7, 0.5]] as const) {
            // Eye ray → world → packed camera, the long way round.
            const world = [0, 1, 2].map((r) => worldFromEye[r]! * ex + worldFromEye[3 + r]! * ey + worldFromEye[6 + r]!) as [number, number, number];
            const expected = project(world, packed.heading, packed.pitch, u);
            const uv: Vec2 = [(ex - frustum.left) / (frustum.right - frustum.left), (frustum.up - ey) / (frustum.up - frustum.down)];
            const got = latchSourceUV(uv, u);
            expect(got[0]).toBeCloseTo(expected[0], 6);
            expect(got[1]).toBeCloseTo(expected[1], 6);
        }
    });

    it('moves a 1° turn by 1° of the displayed FOV', () => {
        const u = uniforms({ delta: { yawDeg: 1, pitchDeg: 0 } });
        const hfov = displayedHorizontalFov(1);
        expect(hfov).toBe(90);
        const shift = latchSourceUV([0.5, 0.5], u)[0] - 0.5;
        // tan(1°) / (2 tan(45°)) of the width.
        expect(shift).toBeCloseTo(Math.tan(DEG) / 2, 8);
    });
});

describe('packReprojectUniforms', () => {
    it('packs the mode, the FOV per eye image and the stereo baseline only for stereo', () => {
        const mono = uniforms();
        expect(mono[I.mode]).toBe(REPROJECT_MODE_CODE.latch);
        expect(mono[I.halfIpd]).toBe(0);
        expect(mono[I.tanHalfV]! * (1600 / 900)).toBeCloseTo(mono[I.tanHalfH]!, 6);
        const sbs = uniforms({ mode: 'sbs' });
        expect(sbs[I.halfIpd]).toBeCloseTo(DEFAULT_IPD_METRES / 2, 7);
        expect(sbs[I.depthFar]).toBe(DEPTH_FAR_METRES);
        expect(uniforms({ fillBlur: false })[I.fillBlur]).toBe(0);
    });
});

describe('stereo synthesis', () => {
    const u = uniforms({ mode: 'sbs' });

    it('moves near things right in the left eye and left in the right eye; the sky sits behind the screen', () => {
        // Relative to what is behind them (the convergence plane is 1 m, so 2.7 m is still behind the screen).
        expect(eyeShift(0.1, -1, u)).toBeGreaterThan(eyeShift(0.5, -1, u));
        expect(eyeShift(0.1, 1, u)).toBeLessThan(eyeShift(0.5, 1, u));
        // Nothing is nearer than the near clamp (1.2 m, under the car's nose).
        expect(eyeShift(0.5 / DEPTH_FAR_METRES, -1, u)).toBe(eyeShift(1.2 / DEPTH_FAR_METRES, -1, u));
        // Uncrossed: the sky moves left in the left eye, right in the right.
        expect(eyeShift(1, -1, u)).toBeLessThan(0);
        expect(eyeShift(1, 1, u)).toBeGreaterThan(0);
        // At the convergence distance (1 m, under the near clamp) everything nearer is clamped.
        const [far, near] = eyeShiftRange(-1, u);
        expect(near).toBeGreaterThan(far);
    });

    // A centre image 1000 px wide: background at 20 m, a box at 2 m from x 0.40 to 0.55.
    const W = 1000;
    const boxDepth = 2 / DEPTH_FAR_METRES;
    const bgDepth = 20 / DEPTH_FAR_METRES;
    const depthAt = (x: number) => (x >= 0.4 && x < 0.55 ? boxDepth : bgDepth);
    const inBox = (x: number) => x >= 0.4 && x < 0.55;

    it('shows the box where its parallax puts it, and background elsewhere', () => {
        const sBox = eyeShift(boxDepth, -1, u);
        const sBg = eyeShift(bgDepth, -1, u);
        // Middle of the moved box.
        const mid = stereoSourceX(0.475 + sBox, -1, depthAt, u);
        expect(mid.consistent).toBe(true);
        expect(inBox(mid.x)).toBe(true);
        // Far from the box: background, consistent, moved by the background's shift.
        const bg = stereoSourceX(0.2, -1, depthAt, u);
        expect(bg.consistent).toBe(true);
        expect(bg.x).toBeCloseTo(0.2 - sBg, 2);
    });

    it('fills the disocclusion with background from the occluder edge, never the box, and leaves no pixel unwritten', () => {
        const sBox = eyeShift(boxDepth, -1, u);
        const sBg = eyeShift(bgDepth, -1, u);
        expect(sBox - sBg).toBeGreaterThan(5 / W); // a visible band at 1000 px
        let unwritten = 0;
        let filled = 0;
        let smeared = 0;
        // The band the left eye sees left of the moved box.
        for (let px = Math.floor((0.4 + sBg) * W); px < Math.ceil((0.4 + sBox) * W); px++) {
            const x = (px + 0.5) / W;
            const hit = stereoSourceX(x, -1, depthAt, u);
            if (!Number.isFinite(hit.x)) unwritten++;
            if (!hit.consistent) {
                filled++;
                if (inBox(hit.x)) smeared++;
                // From the background just left of the box edge.
                expect(hit.x).toBeLessThan(0.4);
                expect(0.4 - hit.x).toBeLessThan(sBox - sBg + 2 / W);
            }
        }
        expect(unwritten).toBe(0);
        expect(smeared).toBe(0);
        expect(filled).toBeGreaterThan(0);
    });

    it('is symmetric: the right eye disoccludes on the box\'s right side', () => {
        const sBox = eyeShift(boxDepth, 1, u);
        const sBg = eyeShift(bgDepth, 1, u);
        const x = 0.55 + (sBox + sBg) / 2;
        const hit = stereoSourceX(x, 1, depthAt, u);
        expect(hit.consistent).toBe(false);
        expect(hit.x).toBeGreaterThanOrEqual(0.55);
    });
});

describe('ReprojectUniforms — one layout in TS and reproject.wgsl', () => {
    it('every index lands on the WGSL member it names', () => {
        const source = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', 'reproject.wgsl'), 'utf8');
        const start = source.indexOf('struct ReprojectUniforms');
        const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('};', start));
        // Float offset of each member, with WGSL's 16-byte alignment for vec4.
        const offsets = new Map<string, number>();
        let at = 0;
        for (const line of body.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)) {
            const m = /^(\w+)\s*:\s*(f32|vec4<f32>),?$/.exec(line);
            if (!m) throw new Error(`unexpected ReprojectUniforms member: ${line}`);
            if (m[2] !== 'f32') at = Math.ceil(at / 4) * 4;
            offsets.set(m[1]!, at);
            at += m[2] === 'f32' ? 1 : 4;
        }
        expect(at).toBe(REPROJECT_UNIFORM_FLOAT_COUNT);
        for (const name of ['mode', 'tanHalfH', 'tanHalfV', 'halfIpd', 'convergenceInv', 'depthFar', 'horizonY', 'outputWidth', 'outputHeight', 'eyeSign', 'fillBlur'] as const) {
            expect(offsets.get(name), name).toBe(I[name]);
        }
        expect(offsets.get('outFrustum')).toBe(I.outCentreX);
        expect([I.outCentreY, I.outHalfX, I.outHalfY]).toEqual([I.outCentreX + 1, I.outCentreX + 2, I.outCentreX + 3]);
        expect([offsets.get('rotX'), offsets.get('rotY'), offsets.get('rotZ')]).toEqual([I.rotation, I.rotation + 4, I.rotation + 8]);
    });
});
