import { describe, expect, it } from 'vitest';
import {
  applyLookGradeRgb,
  buildLutVolume,
  LUT_SIZE_DEFAULT,
  shouldLoadLookLut,
  sliceHaldStrip,
} from './lut';
import { LOOK_PACKS } from '../config/lookPacks';

describe('3D LUT volume', () => {
  it('identity volume is a pass-through cube', () => {
    const vol = buildLutVolume('identity', 2);
    expect(vol.size).toBe(2);
    expect(vol.pixels.length).toBe(2 * 2 * 2 * 4);
    expect(Array.from(vol.pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(vol.pixels.slice(vol.pixels.length - 4))).toEqual([255, 255, 255, 255]);
  });

  it('clear look does not request a LUT (ACES-only path)', () => {
    expect(shouldLoadLookLut('clear')).toBe(false);
    expect(shouldLoadLookLut(null)).toBe(false);
    expect(shouldLoadLookLut('noir')).toBe(true);
    expect(shouldLoadLookLut('golden-hour')).toBe(true);
    expect(shouldLoadLookLut('teal-orange')).toBe(true);
  });

  it('noir grade pulls saturation down versus identity', () => {
    const [ir, ig, ib] = applyLookGradeRgb(0.8, 0.2, 0.2, LOOK_PACKS.clear);
    const [nr, ng, nb] = applyLookGradeRgb(0.8, 0.2, 0.2, LOOK_PACKS.noir);
    const identChroma = Math.max(ir, ig, ib) - Math.min(ir, ig, ib);
    const noirChroma = Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
    expect(noirChroma).toBeLessThan(identChroma);
  });

  it('slices a HALD strip back into z-major voxels', () => {
    const size = 2;
    const width = size * size;
    const rgba = new Uint8ClampedArray(width * size * 4);
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * width + z * size + x) * 4;
          rgba[i] = x * 80;
          rgba[i + 1] = y * 80;
          rgba[i + 2] = z * 80;
          rgba[i + 3] = 255;
        }
      }
    }
    const vol = sliceHaldStrip(width, size, rgba, 'identity');
    expect(vol.size).toBe(2);
    expect(vol.pixels[0]).toBe(0);
    expect(vol.pixels[4]).toBe(80);
  });

  it('default LUT size is 32³', () => {
    expect(LUT_SIZE_DEFAULT).toBe(32);
    expect(buildLutVolume('golden-hour').size).toBe(32);
  });
});
