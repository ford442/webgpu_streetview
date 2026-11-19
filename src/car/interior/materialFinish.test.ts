// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../VehicleManager';
import { GPU_PROFILES } from './performance';
import { createAccentMaterial, createMaterials, resetGlowRegistry } from './MaterialFactory';
import { ACCENT_TRIM_ALBEDO_SCALE } from './cabinLightingRamps';

describe('cabin material finish', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => undefined,
        fillRect: () => undefined,
        fillStyle: '',
      };
    } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetGlowRegistry();
  });

  it('gives sedan leather and dash a highlight the sun and cluster can catch', () => {
    const { dashboard, leather, chrome } = createMaterials(VEHICLES.sedan, GPU_PROFILES.medium);
    expect(dashboard.roughness).toBeGreaterThan(0.4);
    expect(dashboard.roughness).toBeLessThan(0.7);
    expect(dashboard.clearcoat).toBeGreaterThan(0.2);
    expect(dashboard.envMapIntensity).toBeGreaterThan(0.7);
    expect(leather.roughness).toBeGreaterThan(0.4);
    expect(leather.roughness).toBeLessThan(0.65);
    expect(leather.clearcoat).toBeGreaterThan(0.1);
    expect(leather.sheenColor.r).toBeGreaterThan(0.4);
    expect(leather.sheenColor.r).toBeGreaterThan(leather.sheenColor.b);
    // Vent chrome stays metal, but not a mirror.
    expect(chrome.roughness).toBeGreaterThan(0.1);
    expect(chrome.metalness).toBe(1);
  });

  it('keeps the science-lab dash cooler and glossier than the sedan', () => {
    const sedan = createMaterials(VEHICLES.sedan, GPU_PROFILES.medium);
    const lab = createMaterials(VEHICLES['science-lab'], GPU_PROFILES.medium);
    expect(lab.dashboard.roughness).toBeLessThan(sedan.dashboard.roughness);
    expect(lab.dashboard.clearcoat).toBeGreaterThan(sedan.dashboard.clearcoat);
    expect(lab.leather.sheenColor.b).toBeGreaterThan(lab.leather.sheenColor.r);
    expect(lab.dashboard.color.g).toBeGreaterThan(sedan.dashboard.color.g);
  });

  it('keeps the accent on the emissive and paints trim as smoked lacquer', () => {
    for (const config of Object.values(VEHICLES)) {
      const { accent } = createMaterials(config, GPU_PROFILES.medium);
      const ring = createAccentMaterial(config, 0.45);
      for (const mat of [accent, ring]) {
        // The light is the full vehicle accent, so night glow follows config.accentColor.
        expect(`#${mat.emissive.getHexString()}`).toBe(config.accentColor.toLowerCase());
        // The paint is the same hue, darkened: by day the sun and the pano IBL
        // light lacquered trim, not a second copy of the night glow.
        for (const ch of ['r', 'g', 'b'] as const) {
          expect(mat.color[ch]).toBeCloseTo(mat.emissive[ch] * ACCENT_TRIM_ALBEDO_SCALE, 6);
        }
        expect(Math.max(mat.color.r, mat.color.g, mat.color.b)).toBeLessThanOrEqual(0.15);
      }
    }
  });
});
