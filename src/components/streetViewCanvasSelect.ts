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
 *
 * A clear margin is not enough on its own. Switching into car mode, the panorama
 * canvases briefly report 2560×1323 and 1011×1323 while the dashboard lays out.
 * That ≈2.5× gap clears any sensible area ratio, so a rival must *also* stay the
 * winner for `CANVAS_TAKEOVER_CONFIRM_MS` before it takes the scrape. A real
 * resize holds its size, but a layout blip does not.
 */

/** A rival must beat the promoted canvas by this factor in area to take over. */
export const CANVAS_TAKEOVER_AREA_RATIO = 1.25;

/**
 * …and stay the winner (the same element) for this long. That is several
 * scrape polls, longer than a layout settle and short next to a real resize.
 */
export const CANVAS_TAKEOVER_CONFIRM_MS = 750;

/** The rival currently bidding to replace the promoted canvas, and since when. */
export interface CanvasTakeoverState {
    rival: HTMLCanvasElement | null;
    since: number;
}

export function createTakeoverState(): CanvasTakeoverState {
    return { rival: null, since: 0 };
}

function resetTakeover(takeover: CanvasTakeoverState | undefined): void {
    if (!takeover) return;
    takeover.rival = null;
    takeover.since = 0;
}

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
 * @param active    the canvas we are already scraping, if any
 * @param minEdge   smallest edge (px) a canvas may have and still be usable
 * @param takeover  persistent bid state. Without it, a rival that clears the
 *                  area ratio takes over at once; with it, the rival must hold
 *                  its win for `CANVAS_TAKEOVER_CONFIRM_MS`.
 * @param now       clock for the confirmation window (ms)
 */
export function selectSourceCanvas(
    container: HTMLElement,
    active: HTMLCanvasElement | null,
    minEdge: number,
    takeover?: CanvasTakeoverState,
    now: number = performance.now()
): CanvasSelection {
    const scan = selectLargestCanvas(container);
    // Gone or degenerate: re-acquire immediately.
    if (!active || !active.isConnected || !container.contains(active)
        || active.width < minEdge || active.height < minEdge) {
        resetTakeover(takeover);
        return scan;
    }

    const activeArea = active.width * active.height;
    const keep: CanvasSelection = { best: active, canvasCount: scan.canvasCount, selectedArea: activeArea };
    const rivalWins = scan.best !== active
        && scan.selectedArea > activeArea * CANVAS_TAKEOVER_AREA_RATIO;
    if (!rivalWins) {
        resetTakeover(takeover);
        return keep;
    }
    if (!takeover) return scan;

    if (takeover.rival !== scan.best) {
        takeover.rival = scan.best;
        takeover.since = now;
        return keep;
    }
    if (now - takeover.since < CANVAS_TAKEOVER_CONFIRM_MS) return keep;

    resetTakeover(takeover);
    return scan;
}
