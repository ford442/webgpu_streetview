// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PICKER_THUMB_HEIGHT, PICKER_THUMB_WIDTH } from './lumaMath';
import { makePickerThumbDataUrl, pickerPrescaleSize, PICKER_PRESCALE } from './pickerThumb';

/**
 * jsdom has no 2D context: give every canvas a minimal fake one that records
 * what it is asked to draw and hands back a solid-colour image.
 */
function installFake2d(fill: [number, number, number, number]) {
  const drawImage = vi.fn();
  const putImageData = vi.fn();
  const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) data.set(fill, i);
    return { data, width: w, height: h };
  });
  const createImageData = vi.fn((w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
  }));
  const ctx = { drawImage, putImageData, getImageData, createImageData };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement['getContext'],
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  return { drawImage, putImageData, getImageData };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makePickerThumbDataUrl', () => {
  it('returns null for a zero-size source', () => {
    const src = document.createElement('canvas');
    src.width = 0;
    src.height = 0;
    expect(makePickerThumbDataUrl(src)).toBeNull();
  });

  it('never reads back or downsamples a full-resolution 5K still', () => {
    const fake = installFake2d([10, 20, 30, 255]);
    const still = { width: 5120, height: 2880 } as unknown as HTMLCanvasElement;
    const downsample = vi.fn((_rgba: Uint8ClampedArray, _w: number, _h: number, dw: number, dh: number) =>
      new Uint8Array(dw * dh * 4));

    expect(makePickerThumbDataUrl(still, downsample)).toBe('data:image/jpeg;base64,AAAA');

    const midW = PICKER_THUMB_WIDTH * PICKER_PRESCALE;
    const midH = PICKER_THUMB_HEIGHT * PICKER_PRESCALE;
    expect(fake.drawImage).toHaveBeenCalledWith(still, 0, 0, midW, midH);
    expect(fake.getImageData).toHaveBeenCalledWith(0, 0, midW, midH);
    expect(downsample).toHaveBeenCalledTimes(1);
    const [rgba, w, h, dw, dh] = downsample.mock.calls[0]!;
    expect([w, h, dw, dh]).toEqual([midW, midH, PICKER_THUMB_WIDTH, PICKER_THUMB_HEIGHT]);
    expect(rgba.length).toBe(midW * midH * 4);
    expect(rgba.length).toBeLessThan(1024 * 1024);
  });

  it('box-filters the intermediate with the WASM downsample_2d by default', () => {
    const fake = installFake2d([200, 100, 50, 255]);
    const still = { width: 1920, height: 1080 } as unknown as HTMLCanvasElement;
    expect(makePickerThumbDataUrl(still)).toMatch(/^data:image\/jpeg/);
    const put = fake.putImageData.mock.calls[0]![0] as { data: Uint8ClampedArray; width: number; height: number };
    expect([put.width, put.height]).toEqual([PICKER_THUMB_WIDTH, PICKER_THUMB_HEIGHT]);
    for (let i = 0; i < put.data.length; i += 4) {
      expect(Array.from(put.data.subarray(i, i + 4))).toEqual([200, 100, 50, 255]);
    }
  });

  it('does not upscale a source smaller than the intermediate', () => {
    expect(pickerPrescaleSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(pickerPrescaleSize(5120, 100)).toEqual({ width: PICKER_THUMB_WIDTH * PICKER_PRESCALE, height: 100 });
    expect(pickerPrescaleSize(5120, 2880, 4, 2)).toEqual({ width: 16, height: 8 });
  });
});
