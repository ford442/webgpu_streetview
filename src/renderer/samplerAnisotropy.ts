import type { QualityLevel } from '../config/visualPresets';

/**
 * Sampler anisotropy for the panorama pass. Low stays 1; higher presets may
 * raise filtering when the device allows (see docs/RENDERER_FALLBACK.md).
 */
export function getSamplerAnisotropyForQuality(quality: QualityLevel): number {
    switch (quality) {
        case 'low': return 1;
        case 'medium': return 2;
        case 'high': return 4;
        case 'ultra': return 8;
    }
}

export function clampSamplerAnisotropy(requested: number, device: GPUDevice): number {
    const max = Number((device.limits as GPUSupportedLimits & { maxAnisotropy?: number }).maxAnisotropy ?? 1);
    if (!Number.isFinite(max) || max <= 1) return 1;
    return Math.max(1, Math.min(requested, max));
}
