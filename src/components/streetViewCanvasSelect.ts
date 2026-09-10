/**
 * streetViewCanvasSelect.ts — which of Google's canvases we scrape.
 *
 * Google Maps keeps several canvases inside the panorama container and churns
 * them across a hop: a new one is inserted at a partial layout size, grows to
 * the container size a frame or two later, and the outgoing one is removed.
 * Picking "largest area" fresh on every poll therefore flip-flops between two
 * elements of different sizes while a hop settles.
 *
 * That flapping is not cosmetic. The scrape fingerprint embeds the canvas
 * dimensions (`panoramaStability.getCanvasFingerprint`), so a size flap never
 * reaches a stable sample, and `TextureLifecycle.uploadLiveSource` reallocates
 * the GPU source texture on each change — the panorama visibly warps because
 * the live pass stretches whatever source it has across the full screen quad.
 *
 * So selection is sticky: once a canvas is promoted we keep scraping it while
 * it is attached and full-size, and only hand over when it is gone, has gone
 * degenerate, or a rival beats it by a clear margin (a real container resize,
 * not a mid-hop layout blip).
 */

/** A rival must beat the promoted canvas by this factor in area to take over. */
export const CANVAS_TAKEOVER_AREA_RATIO = 1.25;

export interface CanvasSelection {
    best: HTMLCanvasElement | null;
    canvasCount: number;
    selectedArea: number;
}

/** Largest-area canvas in the container, with no regard for what came before. */
export function selectLargestCanvas(container: HTMLElement): CanvasSelection {
    const canvases = container.getElementsByTagName('canvas');
    const canvasCount = canvases.length;
    if (canvasCount === 0) {
        return { best: null, canvasCount: 0, selectedArea: 0 };
    }
    let best = canvases[0]!;
    let maxArea = best.width * best.height;
    for (let i = 1; i < canvasCount; i++) {
        const c = canvases[i]!;
        const area = c.width * c.height;
        if (area > maxArea) {
            maxArea = area;
            best = c;
        }
    }
    return { best, canvasCount, selectedArea: maxArea };
}

/**
 * Largest-area selection with hysteresis around the currently scraped canvas.
 *
 * @param active   the canvas we are already scraping, if any
 * @param minEdge  smallest edge (px) a canvas may have and still be usable
 */
export function selectSourceCanvas(
    container: HTMLElement,
    active: HTMLCanvasElement | null,
    minEdge: number
): CanvasSelection {
    const scan = selectLargestCanvas(container);
    if (!active || !active.isConnected || !container.contains(active)) return scan;
    if (active.width < minEdge || active.height < minEdge) return scan;

    const activeArea = active.width * active.height;
    if (scan.selectedArea > activeArea * CANVAS_TAKEOVER_AREA_RATIO) return scan;

    return { best: active, canvasCount: scan.canvasCount, selectedArea: activeArea };
}
