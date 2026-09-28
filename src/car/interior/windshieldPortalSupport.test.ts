/**
 * The portal gate: strict, explained, and never an error. Anything short of the
 * shared WebGPU device with `clip-distances` is a clean fallback to hole + decal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    getWindshieldPortalSupport,
    isPortalDisabledByFlag,
    resetWindshieldPortalSupportForTests,
    resolveWindshieldPortalSupport,
    setWindshieldPortalSupport,
} from './windshieldPortalSupport';

afterEach(() => resetWindshieldPortalSupportForTests());

const deviceWith = (...features: string[]) =>
    ({ features: new Set(features) }) as unknown as Pick<GPUDevice, 'features'>;

describe('resolveWindshieldPortalSupport', () => {
    it('is enabled on the shared WebGPU device when clip-distances is present, and remembers which device', () => {
        const device = deviceWith('clip-distances', 'float32-filterable');
        const support = resolveWindshieldPortalSupport({ backend: 'webgpu', device, search: '' });
        expect(support).toMatchObject({ enabled: true, clipDistances: true });
        // So the portal can refuse a road frame that lives on a different device.
        expect(support.device).toBe(device);
    });

    it('falls back when the device has no clip-distances — and says why', () => {
        const support = resolveWindshieldPortalSupport({
            backend: 'webgpu',
            device: deviceWith('float32-filterable'),
            search: '',
        });
        expect(support.enabled).toBe(false);
        expect(support.clipDistances).toBe(false);
        expect(support.reason).toMatch(/clip-distances/);
    });

    it('never builds the portal on the WebGL cabin, whatever the device says', () => {
        const support = resolveWindshieldPortalSupport({
            backend: 'webgl',
            device: deviceWith('clip-distances'),
            search: '',
        });
        expect(support.enabled).toBe(false);
        expect(support.reason).toMatch(/WebGL/);
    });

    it('falls back without a shared device', () => {
        const support = resolveWindshieldPortalSupport({ backend: 'webgpu', device: undefined, search: '' });
        expect(support.enabled).toBe(false);
        expect(support.reason).toMatch(/device/i);
    });

    it('?portal=off forces the fallback even when everything is available', () => {
        const support = resolveWindshieldPortalSupport({
            backend: 'webgpu',
            device: deviceWith('clip-distances'),
            search: '?portal=off',
        });
        expect(support.enabled).toBe(false);
        expect(support.clipDistances).toBe(true);
        expect(support.reason).toMatch(/portal=off/);
    });

    it('survives a device whose features getter throws', () => {
        const hostile = {
            get features(): never {
                throw new Error('device lost');
            },
        } as unknown as Pick<GPUDevice, 'features'>;
        expect(() =>
            resolveWindshieldPortalSupport({ backend: 'webgpu', device: hostile, search: '' }),
        ).not.toThrow();
    });
});

describe('isPortalDisabledByFlag', () => {
    it.each([
        ['?portal=off', true],
        ['?portal=OFF', true],
        ['?portal=0', true],
        ['?portal=false', true],
        ['portal=off', true],
        ['?portal=on', false],
        ['?portal=1', false],
        ['?portal', false],
        ['', false],
        ['?cabin=webgl', false],
    ])('%s -> %s', (search, expected) => {
        expect(isPortalDisabledByFlag(search)).toBe(expected);
    });
});

describe('module state', () => {
    it('defaults to off, so unit tests and the ?cabin=webgl hatch need no wiring', () => {
        expect(getWindshieldPortalSupport().enabled).toBe(false);
    });

    it('holds what the cabin renderer construction resolved', () => {
        setWindshieldPortalSupport({ enabled: true, clipDistances: true });
        expect(getWindshieldPortalSupport().enabled).toBe(true);
        resetWindshieldPortalSupportForTests();
        expect(getWindshieldPortalSupport().enabled).toBe(false);
    });
});
