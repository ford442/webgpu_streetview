// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../VehicleManager';
import { GPU_PROFILES } from '../../utils/performance';
import { createMaterials } from './MaterialFactory';

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
  afterEach(() => vi.restoreAllMocks());

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
});
