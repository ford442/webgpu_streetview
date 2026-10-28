// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { VEHICLES, type VehicleType } from '../VehicleManager';
import { GPU_PROFILES } from './performance';
import { createMaterials } from './MaterialFactory';

/**
 * The cabin has no ambient blanket, so a surface can only read if it has
 * albedo to light. Two regressions made the dash invisible by construction:
 * its colour was darker than real black plastic (0x1a1a1a, linear ~0.010), and
 * its grain `map` — which *multiplies* the colour — was 0–8/255 noise, scaling
 * the diffuse term by ~0.016. The dash then only ever showed Fresnel
 * reflections by day and was pure black at night, whatever the lights did.
 *
 * jsdom has no 2D canvas, so the stub records what each factory canvas was
 * painted with and the tests read it back off `texture.image`.
 */
describe('dashboard albedo', () => {
  const painted = new WeakMap<object, { data: Uint8ClampedArray }>();

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext' as never).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (img: { data: Uint8ClampedArray }) => painted.set(this, img),
        fillRect: () => undefined,
        fillStyle: '',
      };
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  /** Mean red channel of a painted factory texture, 0–1. */
  const meanRed = (tex: THREE.Texture): number => {
    const img = painted.get(tex.image as object);
    expect(img, 'texture was painted through the stubbed 2D context').toBeDefined();
    let sum = 0;
    for (let i = 0; i < img!.data.length; i += 4) sum += img!.data[i]!;
    return sum / (img!.data.length / 4) / 255;
  };

  const vehicles = Object.keys(VEHICLES) as VehicleType[];

  it.each(vehicles)('%s: grain modulates the dash colour instead of zeroing it', (type) => {
    const { dashboard } = createMaterials(VEHICLES[type], GPU_PROFILES.medium);
    // Clinical dashes are untextured plain colour.
    if (!dashboard.map) return;
    expect(meanRed(dashboard.map)).toBeGreaterThan(0.8);
  });

  it.each(vehicles)('%s: effective dash albedo stays in the black-plastic range', (type) => {
    const { dashboard, frame } = createMaterials(VEHICLES[type], GPU_PROFILES.medium);
    const grain = dashboard.map ? meanRed(dashboard.map) : 1;
    // Linear albedo (Color is linear working space). Real black dash plastic is
    // ~0.03–0.05; the floor leaves room for the near-black cortianics trim
    // while still being ~50x what the old crushed grain left.
    expect(dashboard.color.g * grain).toBeGreaterThan(0.015);
    expect(frame.color.g).toBeGreaterThan(0.012);
  });
});
