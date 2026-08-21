import { describe, expect, it } from 'vitest';
import { downsample2d } from './lumaMath';
import { makePickerThumbDataUrl } from './pickerThumb';

describe('makePickerThumbDataUrl', () => {
  it('returns a JPEG data URL from a canvas via downsample_2d', () => {
    const src = document.createElement('canvas');
    src.width = 8;
    src.height = 8;
    const ctx = src.getContext('2d');
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = '#ff0000';
    ctx!.fillRect(0, 0, 8, 8);
    const url = makePickerThumbDataUrl(src, downsample2d, 4, 2);
    expect(url).toMatch(/^data:image\/jpeg/);
  });

  it('returns null for a zero-size source', () => {
    const src = document.createElement('canvas');
    src.width = 0;
    src.height = 0;
    expect(makePickerThumbDataUrl(src)).toBeNull();
  });
});
