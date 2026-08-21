/**
 * #154-style goldens: JS hist/reduce/downsample vs the shipping WASM vectors.
 * GPU hist is skipped in jsdom (no adapter); when `navigator.gpu` exists the
 * same packed-RGBA fixture is the contract — GPU texture sampling is a gauge
 * signal (sRGB vs linear) and is not asserted bit-identical here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { downsample2d, lumaHistogramBt709, reduceLumaBt709 } from './lumaMath';

const ROOT = join(__dirname, '..', '..', '..');

interface ChoresGoldens {
  lumaHistogram: { width: number; height: number; rgba: number[]; expectedBins: number[] };
  lumaReduce: { width: number; height: number; rgba: number[]; expected: number[] };
  downsample2d: {
    width: number; height: number; rgba: number[];
    dstW: number; dstH: number; expected: number[];
  };
}

const goldens = JSON.parse(
  readFileSync(join(ROOT, 'cpp', 'tests', 'goldens.json'), 'utf8'),
) as ChoresGoldens;

describe('gpu-chores WASM/JS goldens', () => {
  it('luma_histogram_bt709 matches goldens.json', () => {
    const rgba = Uint8Array.from(goldens.lumaHistogram.rgba);
    const bins = lumaHistogramBt709(rgba, goldens.lumaHistogram.width, goldens.lumaHistogram.height);
    goldens.lumaHistogram.expectedBins.forEach((expected, i) => {
      expect(bins[i], `hist[${i}]`).toBe(expected);
    });
  });

  it('reduce_luma_bt709 matches goldens.json', () => {
    const rgba = Uint8Array.from(goldens.lumaReduce.rgba);
    const reduced = reduceLumaBt709(rgba, goldens.lumaReduce.width, goldens.lumaReduce.height);
    expect(reduced.mean).toBeCloseTo(goldens.lumaReduce.expected[0]!, 5);
    expect(reduced.min).toBeCloseTo(goldens.lumaReduce.expected[1]!, 5);
    expect(reduced.max).toBeCloseTo(goldens.lumaReduce.expected[2]!, 5);
  });

  it('downsample_2d matches goldens.json', () => {
    const src = Uint8Array.from(goldens.downsample2d.rgba);
    const dst = downsample2d(
      src,
      goldens.downsample2d.width,
      goldens.downsample2d.height,
      goldens.downsample2d.dstW,
      goldens.downsample2d.dstH,
    );
    expect([...dst]).toEqual(goldens.downsample2d.expected);
  });

  it('skips GPU hist contract when no WebGPU adapter is available', () => {
    const gpu = (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
    expect(gpu).toBeFalsy();
  });
});
