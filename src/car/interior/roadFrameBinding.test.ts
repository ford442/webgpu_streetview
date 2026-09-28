/**
 * The cabin's binding of the road renderer's texture. The road owns that texture;
 * these tests pin the ways the cabin could accidentally destroy or go stale on it.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { RoadHdrFrame } from '../../renderer/roadFrameRegistry';
import { createNeutralRoadLook } from '../../renderer/roadFrameRegistry';
import { RoadFrameBinding, neuterDestroy, threeLayoutForFormat } from './roadFrameBinding';

function fakeGpuTexture(label = 'tex') {
    const view = { kind: 'view' };
    const texture = {
        label,
        width: 640,
        height: 360,
        destroy: vi.fn(),
        createView: vi.fn(function (this: unknown) {
            // WebGPU brand-checks `this`; a bound-to-the-wrong-object call would throw.
            if (this !== texture) throw new TypeError('Illegal invocation');
            return view;
        }),
    };
    return texture as unknown as GPUTexture & {
        destroy: ReturnType<typeof vi.fn>;
        createView: ReturnType<typeof vi.fn>;
    };
}

const DEVICE = {} as GPUDevice;

function frame(texture: GPUTexture, format: GPUTextureFormat = 'rg11b10ufloat'): RoadHdrFrame {
    return { texture, device: DEVICE, format, width: 640, height: 360, held: false, look: createNeutralRoadLook() };
}

describe('neuterDestroy', () => {
    it('turns destroy() into a no-op — three would otherwise destroy the road\'s live texture', () => {
        const real = fakeGpuTexture();
        neuterDestroy(real).destroy();
        expect(real.destroy).not.toHaveBeenCalled();
    });

    it('forwards everything else to the real texture, with the real object as `this`', () => {
        const real = fakeGpuTexture();
        const wrapped = neuterDestroy(real);
        expect(wrapped.width).toBe(640);
        expect(wrapped.label).toBe('tex');
        expect(() => wrapped.createView()).not.toThrow();
        expect(real.createView).toHaveBeenCalledTimes(1);
    });
});

describe('RoadFrameBinding', () => {
    it('is unbound, and reports no frame, until the road publishes one', () => {
        const slot = { value: 'placeholder' as unknown };
        const binding = new RoadFrameBinding(slot);
        expect(binding.sync(null)).toBe(false);
        expect(binding.isBound()).toBe(false);
        expect(slot.value).toBe('placeholder');
    });

    it('wraps the road texture in an ExternalTexture and puts it in the slot', () => {
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        expect(binding.sync(frame(fakeGpuTexture()))).toBe(true);
        expect(slot.value).toBeInstanceOf(THREE.ExternalTexture);
        expect(slot.value).toBe(binding.getWrapper());
    });

    it('never hands three the real texture, only the destroy-proof view of it', () => {
        const real = fakeGpuTexture();
        const slot = { value: null as unknown };
        new RoadFrameBinding(slot).sync(frame(real));
        const source = (slot.value as THREE.ExternalTexture).sourceTexture as unknown as GPUTexture;
        expect(source).not.toBe(real);
        // Disposing the wrapper is what makes three call destroy() on its source.
        (source as unknown as { destroy(): void }).destroy();
        expect(real.destroy).not.toHaveBeenCalled();
    });

    it('does not rebuild the wrapper while the road keeps the same texture', () => {
        const real = fakeGpuTexture();
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        binding.sync(frame(real));
        const first = slot.value;
        binding.sync(frame(real));
        binding.sync(frame(real));
        expect(slot.value).toBe(first);
    });

    it('makes a NEW wrapper when the road replaces its texture, even at the same size', () => {
        // three caches the bind-group view under `view-<w>-<h>-<mips>`; re-pointing
        // the old wrapper would keep serving a view of the destroyed texture.
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        binding.sync(frame(fakeGpuTexture('a')));
        const first = slot.value as THREE.ExternalTexture;
        binding.sync(frame(fakeGpuTexture('b')));
        const second = slot.value as THREE.ExternalTexture;
        expect(second).not.toBe(first);
        expect(second).toBeInstanceOf(THREE.ExternalTexture);
    });

    it('disposes the wrapper it replaces, so three\'s bookkeeping is released on every road resize', () => {
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        const firstTexture = fakeGpuTexture('a');
        binding.sync(frame(firstTexture));
        const first = slot.value as THREE.ExternalTexture;
        const disposed = vi.fn();
        first.addEventListener('dispose', disposed);

        binding.sync(frame(fakeGpuTexture('b')));
        expect(disposed).toHaveBeenCalledTimes(1);
    });

    it('disposing a wrapper — as three does — never destroys the road\'s texture', () => {
        // three tears an ExternalTexture down by calling `sourceTexture.destroy()` from its
        // dispose listener. Reproduce that listener: the real texture must survive it.
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        const road = fakeGpuTexture('road');
        binding.sync(frame(road));
        const wrapper = slot.value as THREE.ExternalTexture;
        wrapper.addEventListener('dispose', () => {
            (wrapper.sourceTexture as unknown as { destroy(): void }).destroy();
        });

        binding.sync(frame(fakeGpuTexture('next'))); // replacement disposes the old wrapper
        binding.release(); //                           and so does release
        expect(road.destroy).not.toHaveBeenCalled();
    });

    it('keeps the last binding if the road briefly has no frame', () => {
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        binding.sync(frame(fakeGpuTexture()));
        const bound = slot.value;
        expect(binding.sync(null)).toBe(false);
        expect(slot.value).toBe(bound);
    });

    it('release() forgets the texture and releases the wrapper, without destroying the texture', () => {
        const real = fakeGpuTexture();
        const slot = { value: null as unknown };
        const binding = new RoadFrameBinding(slot);
        binding.sync(frame(real));
        const disposed = vi.fn();
        (slot.value as THREE.ExternalTexture).addEventListener('dispose', disposed);
        binding.release();
        expect(binding.isBound()).toBe(false);
        expect(disposed).toHaveBeenCalledTimes(1);
        expect(real.destroy).not.toHaveBeenCalled();
    });

    it('describes the wrapper in three terms that match the GPU format', () => {
        const slot = { value: null as unknown };
        new RoadFrameBinding(slot).sync(frame(fakeGpuTexture(), 'rgba16float'));
        const ext = slot.value as THREE.ExternalTexture;
        expect(ext.type).toBe(THREE.HalfFloatType);
        expect(ext.format).toBe(THREE.RGBAFormat);
        expect(ext.magFilter).toBe(THREE.LinearFilter);
        expect(ext.generateMipmaps).toBe(false);
        // HDR radiance, not an sRGB image: three must not colour-convert on sample.
        expect(ext.colorSpace).toBe(THREE.NoColorSpace);
    });
});

describe('threeLayoutForFormat', () => {
    it('maps both intermediate formats the renderer can choose', () => {
        expect(threeLayoutForFormat('rgba16float')).toEqual({
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
        });
        expect(threeLayoutForFormat('rg11b10ufloat')).toEqual({
            format: THREE.RGBFormat,
            type: THREE.UnsignedInt101111Type,
        });
    });
});
