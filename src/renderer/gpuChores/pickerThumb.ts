/**
 * Snapshot-gallery picker thumb: a small JPEG of a captured still.
 *
 * Two stages, so neither the JS heap nor the WASM scratch arena ever holds the
 * full-resolution frame (a 5K still is ~59 MiB of RGBA; pushed through the
 * arena it pinned 64 MiB of the 128 MiB wasm memory cap — #341):
 *   1. the 2D canvas scales the source onto at most {@link PICKER_PRESCALE}×
 *      the thumb per axis (640×360, ~0.9 MiB) — a GPU-backed `drawImage`;
 *   2. the WASM `downsample_2d` box filter takes that to the thumb (an exact
 *      4:1 box when the source was at least that large).
 * GPU texture downsample (panorama analysis, depth input) lives on
 * GpuChores.downsampleTexture.
 */

import { requireWasm } from '../../wasm';
import { PICKER_THUMB_HEIGHT, PICKER_THUMB_WIDTH } from './lumaMath';

/** Largest intermediate, per axis, as a multiple of the thumb. */
export const PICKER_PRESCALE = 4;

export type PickerDownsampleFn = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dstW: number,
  dstH: number,
) => Uint8Array;

const wasmDownsample: PickerDownsampleFn = (rgba, width, height, dstW, dstH) =>
  requireWasm().downsample2d(rgba, width, height, dstW, dstH);

/** The intermediate the 2D canvas scales the source onto (never larger than the source). */
export function pickerPrescaleSize(
  srcW: number,
  srcH: number,
  dstW: number = PICKER_THUMB_WIDTH,
  dstH: number = PICKER_THUMB_HEIGHT,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(srcW, dstW * PICKER_PRESCALE)),
    height: Math.max(1, Math.min(srcH, dstH * PICKER_PRESCALE)),
  };
}

export function makePickerThumbDataUrl(
  source: CanvasImageSource,
  downsample: PickerDownsampleFn = wasmDownsample,
  dstW: number = PICKER_THUMB_WIDTH,
  dstH: number = PICKER_THUMB_HEIGHT,
): string | null {
  if (typeof document === 'undefined') return null;
  const srcW = 'width' in source ? Number(source.width) : 0;
  const srcH = 'height' in source ? Number(source.height) : 0;
  if (!(srcW > 0) || !(srcH > 0)) return null;

  const mid = pickerPrescaleSize(srcW, srcH, dstW, dstH);
  const src = document.createElement('canvas');
  src.width = mid.width;
  src.height = mid.height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  try {
    sctx.drawImage(source, 0, 0, mid.width, mid.height);
  } catch {
    return null;
  }
  const image = sctx.getImageData(0, 0, mid.width, mid.height);
  const packed = downsample(image.data, mid.width, mid.height, dstW, dstH);

  const out = document.createElement('canvas');
  out.width = dstW;
  out.height = dstH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const dest = octx.createImageData(dstW, dstH);
  dest.data.set(packed);
  octx.putImageData(dest, 0, 0);
  return out.toDataURL('image/jpeg', 0.7);
}
