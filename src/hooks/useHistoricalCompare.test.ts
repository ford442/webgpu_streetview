import { describe, expect, it, vi } from 'vitest';
import { captureCompareStill } from './useHistoricalCompare';

describe('captureCompareStill', () => {
  it('is the presented frame, cabin included, when the compositor drew the cabin', () => {
    const renderer = { getCanvasDataURL: vi.fn(() => 'data:frame'), isCabinCompositedInFrame: () => true };
    expect(captureCompareStill(renderer)).toEqual({ url: 'data:frame', includesCabin: true });
  });

  it('is road-only on the WebGL hatch and other stand-downs — no cabin crop', () => {
    const renderer = { getCanvasDataURL: vi.fn(() => 'data:road'), isCabinCompositedInFrame: () => false };
    expect(captureCompareStill(renderer)).toEqual({ url: 'data:road', includesCabin: false });
  });

  it('is road-only on a renderer that cannot answer (WebGL backend)', () => {
    expect(captureCompareStill({ getCanvasDataURL: () => 'data:gl' }).includesCabin).toBe(false);
  });
});
