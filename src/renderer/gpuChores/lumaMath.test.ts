import { describe, expect, it } from 'vitest';
import {
  bt709Bin,
  downsample2d,
  exposureHintFromMeanLuma,
  histDownsampleSize,
  lumaHistogramBt709,
  meanLumaFromHistogram,
  reduceLumaBt709,
} from './lumaMath';

function px(r: number, g: number, b: number, a = 255): number[] {
  return [r, g, b, a];
}

describe('lumaMath BT.709 chores', () => {
  it('bins black at 0 and white at 255', () => {
    expect(bt709Bin(0, 0, 0)).toBe(0);
    expect(bt709Bin(255, 255, 255)).toBe(255);
  });

  it('histogram counts a 2x2 checker', () => {
    const rgba = Uint8Array.from([
      ...px(0, 0, 0), ...px(255, 255, 255),
      ...px(255, 255, 255), ...px(0, 0, 0),
    ]);
    const bins = lumaHistogramBt709(rgba, 2, 2);
    expect(bins[0]).toBe(2);
    expect(bins[255]).toBe(2);
    expect(meanLumaFromHistogram(bins)).toBeCloseTo(0.5, 5);
  });

  it('reduce reports mean/min/max in [0,1]', () => {
    const rgba = Uint8Array.from([...px(0, 0, 0), ...px(255, 255, 255)]);
    const r = reduceLumaBt709(rgba, 2, 1);
    expect(r.count).toBe(2);
    expect(r.min).toBe(0);
    expect(r.max).toBe(1);
    expect(r.mean).toBeCloseTo(0.5, 5);
  });

  it('downsample_2d box-averages 4x2 into 2x1', () => {
    // 4 wide, 2 tall: left 2x2 white, right 2x2 black → dest 2x1: 255, 0
    const src = Uint8Array.from([
      ...px(255, 255, 255), ...px(255, 255, 255), ...px(0, 0, 0), ...px(0, 0, 0),
      ...px(255, 255, 255), ...px(255, 255, 255), ...px(0, 0, 0), ...px(0, 0, 0),
    ]);
    const dst = downsample2d(src, 4, 2, 2, 1);
    expect([...dst.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...dst.subarray(4, 8)]).toEqual([0, 0, 0, 255]);
  });

  it('histDownsampleSize is 1/4 res with a 1px floor', () => {
    expect(histDownsampleSize(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(histDownsampleSize(3, 3)).toEqual({ width: 1, height: 1 });
  });

  it('exposureHintFromMeanLuma targets mid-grey and clamps', () => {
    expect(exposureHintFromMeanLuma(0.18)).toBeCloseTo(0, 5);
    expect(exposureHintFromMeanLuma(0.09)).toBeCloseTo(1, 5);
    expect(exposureHintFromMeanLuma(1)).toBeCloseTo(Math.log2(0.18), 5);
    expect(exposureHintFromMeanLuma(0)).toBe(0);
    expect(exposureHintFromMeanLuma(0.0001)).toBe(2);
  });

  it('no-ops on empty dimensions', () => {
    const bins = lumaHistogramBt709(new Uint8Array(0), 0, 0);
    expect(bins[0]).toBe(0);
    expect(reduceLumaBt709(new Uint8Array(0), 0, 1).count).toBe(0);
    expect(downsample2d(new Uint8Array(16), 2, 2, 0, 1).length).toBe(0);
  });
});
