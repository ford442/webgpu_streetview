/**
 * CPU picker thumb from a canvas via downsample_2d (WASM/JS).
 * GPU texture downsample lives on GpuChores.downsampleTexture.
 */

import { downsample2d, PICKER_THUMB_HEIGHT, PICKER_THUMB_WIDTH } from './lumaMath';

export type PickerDownsampleFn = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dstW: number,
  dstH: number,
) => Uint8Array;

export function makePickerThumbDataUrl(
  source: CanvasImageSource,
  downsample: PickerDownsampleFn = downsample2d,
  dstW: number = PICKER_THUMB_WIDTH,
  dstH: number = PICKER_THUMB_HEIGHT,
): string | null {
  if (typeof document === 'undefined') return null;
  const srcW = 'width' in source ? Number(source.width) : 0;
  const srcH = 'height' in source ? Number(source.height) : 0;
  if (!(srcW > 0) || !(srcH > 0)) return null;

  const src = document.createElement('canvas');
  src.width = srcW;
  src.height = srcH;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  try {
    sctx.drawImage(source, 0, 0);
  } catch {
    return null;
  }
  const image = sctx.getImageData(0, 0, srcW, srcH);
  const packed = downsample(image.data, srcW, srcH, dstW, dstH);

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
