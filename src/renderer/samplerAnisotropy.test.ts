import { describe, expect, it } from 'vitest';
import { clampSamplerAnisotropy, getSamplerAnisotropyForQuality } from './samplerAnisotropy';

describe('samplerAnisotropy', () => {
    it('maps quality presets to 1/2/4/8', () => {
        expect(getSamplerAnisotropyForQuality('low')).toBe(1);
        expect(getSamplerAnisotropyForQuality('medium')).toBe(2);
        expect(getSamplerAnisotropyForQuality('high')).toBe(4);
        expect(getSamplerAnisotropyForQuality('ultra')).toBe(8);
    });

    it('clamps to device maxAnisotropy', () => {
        const device = {
            limits: { maxAnisotropy: 4 },
        } as unknown as GPUDevice;
        expect(clampSamplerAnisotropy(8, device)).toBe(4);
        expect(clampSamplerAnisotropy(1, device)).toBe(1);
    });
});
