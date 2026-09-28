import { describe, expect, it, vi } from 'vitest';
import { getMemoryProfiler } from '../utils/memoryProfiler';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from './gpuMemoryTracking';
import { bytesPerTexel, estimateTextureBytes } from './gpuTextureBytes';

function mockDevice(): GPUDevice {
    return {
        createTexture: vi.fn(() => ({ destroy: vi.fn() })),
        createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    } as unknown as GPUDevice;
}

describe('gpuTextureBytes', () => {
    it('knows the renderer formats', () => {
        expect(bytesPerTexel('rgba16float')).toBe(8);
        expect(bytesPerTexel('rg11b10ufloat')).toBe(4);
        expect(bytesPerTexel('rgba8unorm')).toBe(4);
        expect(bytesPerTexel('rgba32float')).toBe(16);
    });

    it('multiplies layers, samples and sums the mip chain', () => {
        expect(estimateTextureBytes({ width: 4, height: 4, format: 'rgba8unorm' })).toBe(64);
        expect(estimateTextureBytes({ width: 4, height: 4, format: 'rgba8unorm', depthOrArrayLayers: 6 })).toBe(384);
        expect(estimateTextureBytes({ width: 4, height: 4, format: 'rgba8unorm', sampleCount: 4 })).toBe(256);
        // 16 + 4 + 1 texels
        expect(estimateTextureBytes({ width: 4, height: 4, format: 'r8unorm', mipLevelCount: 3 })).toBe(21);
    });
});

describe('gpuMemoryTracking', () => {
    it('tracks create → resize → destroy back to the baseline', () => {
        const profiler = getMemoryProfiler();
        const base = profiler.getGPUMemoryUsage();
        const device = mockDevice();

        let tex = createTrackedTexture(device, { size: [100, 50], format: 'rgba16float', usage: 0 }, 'test');
        expect(profiler.getGPUMemoryUsage().textures - base.textures).toBe(100 * 50 * 8);

        // Resize: destroy + re-create replaces the entry.
        destroyTracked(tex);
        tex = createTrackedTexture(device, { size: { width: 200, height: 50 }, format: 'rgba16float', usage: 0 }, 'test');
        expect(profiler.getGPUMemoryUsage().textures - base.textures).toBe(200 * 50 * 8);

        const buf = createTrackedBuffer(device, { size: 256, usage: 0 }, 'test');
        expect(profiler.getGPUMemoryUsage().buffers - base.buffers).toBe(256);

        destroyTracked(tex);
        destroyTracked(buf);
        destroyTracked(buf); // idempotent
        expect(tex.destroy).toHaveBeenCalled();
        expect(profiler.getGPUMemoryUsage()).toEqual(base);
    });
});
