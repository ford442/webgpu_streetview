import {
    FINGERPRINT_GRID,
    FINGERPRINT_REGION_PX,
    fingerprintFromPixels,
    fingerprintRegion,
    fingerprintScratchContext,
    getCanvasFingerprint,
    isFingerprintable,
} from '../../utils/panoramaStability';

/**
 * Fingerprint a canvas without stalling on it: `createImageBitmap` snapshots
 * the centre region (already downsampled to `FINGERPRINT_GRID`²) when it is
 * called and resolves once the copy is done, so only that 4×4 bitmap is ever
 * read back — not the Maps WebGL canvas, which a `drawImage` + `getImageData`
 * would flush. The snapshot is of the canvas *as it is at the call*, which is
 * what a hold baseline needs.
 *
 * Same hash as `getCanvasFingerprint` up to the downsample filter; it falls
 * back to that synchronous reader where `createImageBitmap` is missing (jsdom).
 */
export async function readCanvasFingerprint(canvas: HTMLCanvasElement): Promise<string> {
    const w = canvas.width;
    const h = canvas.height;
    if (!isFingerprintable(w, h)) return '';
    if (typeof createImageBitmap !== 'function') return getCanvasFingerprint(canvas);
    const { sx, sy } = fingerprintRegion(w, h);
    let bitmap: ImageBitmap | null = null;
    try {
        bitmap = await createImageBitmap(canvas, sx, sy, FINGERPRINT_REGION_PX, FINGERPRINT_REGION_PX, {
            resizeWidth: FINGERPRINT_GRID,
            resizeHeight: FINGERPRINT_GRID,
            resizeQuality: 'low',
        });
        const ctx = fingerprintScratchContext();
        if (!ctx) return '';
        ctx.clearRect(0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID);
        ctx.drawImage(bitmap, 0, 0);
        return fingerprintFromPixels(ctx.getImageData(0, 0, FINGERPRINT_GRID, FINGERPRINT_GRID).data, w, h);
    } catch {
        return '';
    } finally {
        bitmap?.close();
    }
}
