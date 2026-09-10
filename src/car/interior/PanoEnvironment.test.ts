import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

/**
 * Heading alignment and night dim moved off the old three-0.160 workarounds
 * (an equirect pixel blit + a full-scene material walk) onto
 * `scene.environmentRotation` / `scene.environmentIntensity`. These pin the
 * compass convention and the no-op/dispose behaviour.
 */

const target = () => ({ texture: new THREE.Texture(), dispose: vi.fn() });
const fromEquirectangular = vi.fn(target);
const pmremDispose = vi.fn();

vi.mock('./cabinPmrem', () => ({
    createCabinPmrem: vi.fn(() => ({
        fromEquirectangular,
        fromSceneAsync: vi.fn(),
        dispose: pmremDispose,
    })),
}));

import { PanoEnvironment, headingRotationY } from './PanoEnvironment';

const renderer = {} as never;

/** nth PMREM target handed back to the class. */
function producedTarget(n: number) {
    const result = fromEquirectangular.mock.results[n];
    if (!result) throw new Error(`no PMREM target #${n}`);
    return result.value;
}

function make() {
    const scene = new THREE.Scene();
    return { scene, env: new PanoEnvironment(renderer, scene) };
}

function equirect(): HTMLCanvasElement {
    return { width: 256, height: 128 } as HTMLCanvasElement;
}

beforeEach(() => {
    fromEquirectangular.mockClear();
    pmremDispose.mockClear();
});

describe('headingRotationY', () => {
    it('is zero when the image centre already faces east (+X)', () => {
        expect(headingRotationY(90)).toBe(0);
    });

    it('maps degrees off east to radians, signed so the sampled angle shifts back', () => {
        expect(headingRotationY(180)).toBeCloseTo(Math.PI / 2, 6);
        expect(headingRotationY(0)).toBeCloseTo(-Math.PI / 2, 6);
        expect(headingRotationY(270)).toBeCloseTo(Math.PI, 6);
    });
});

describe('PanoEnvironment', () => {
    it('installs the PMREM texture and the heading rotation without touching pixels', () => {
        const { scene, env } = make();
        env.setFromEquirect(equirect(), 180);
        expect(scene.environment).toBe(producedTarget(0).texture);
        expect(scene.environmentRotation.y).toBeCloseTo(Math.PI / 2, 6);
        // the source canvas is handed to the generator as-is
        expect(fromEquirectangular).toHaveBeenCalledTimes(1);
        env.dispose();
    });

    it('dims via scene.environmentIntensity and leaves authored material values alone', () => {
        const { scene, env } = make();
        const mat = new THREE.MeshStandardMaterial({ envMapIntensity: 0.3 });
        scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));

        env.setIntensity(0.4);
        expect(scene.environmentIntensity).toBeCloseTo(0.4, 6);
        expect(mat.envMapIntensity).toBe(0.3);
        env.dispose();
    });

    it('clamps and ignores sub-1% changes', () => {
        const { scene, env } = make();
        env.setIntensity(-2);
        expect(scene.environmentIntensity).toBe(0);
        env.setIntensity(0.005);
        expect(scene.environmentIntensity).toBe(0);
        env.setIntensity(5);
        expect(scene.environmentIntensity).toBe(1);
        env.dispose();
    });

    it('re-asserts the dim level across a pano swap', () => {
        const { scene, env } = make();
        env.setIntensity(0.3);
        scene.environmentIntensity = 1; // e.g. a rebuilt scene
        env.setFromEquirect(equirect(), 90);
        expect(scene.environmentIntensity).toBeCloseTo(0.3, 6);
        env.dispose();
    });

    it('disposes the previous pano target on swap and the generator on dispose', () => {
        const { env } = make();
        env.setFromEquirect(equirect(), 0);
        const first = producedTarget(0);
        env.setFromEquirect(equirect(), 45);
        expect(first.dispose).toHaveBeenCalledTimes(1);

        const second = producedTarget(1);
        env.dispose();
        expect(second.dispose).toHaveBeenCalledTimes(1);
        expect(pmremDispose).toHaveBeenCalledTimes(1);
    });
});
