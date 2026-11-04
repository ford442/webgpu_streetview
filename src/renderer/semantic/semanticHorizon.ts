/**
 * The sky mask's lower edge (#352): where the image-derived horizon
 * (`gpuChores/horizonEstimate.ts`, weather slots 40–41) comes from when a
 * class map exists. Per column, the sky run that starts at the top of the map
 * ends at the skyline; the median over the columns that have one is the
 * frame's sky boundary — a real one, where the luma split guesses.
 *
 * A few hundred columns once per inference: TypeScript beside
 * `horizonEstimate.ts`, like its row means (no WASM export, no goldens).
 */
import { SemanticClass } from './semanticClasses';

/** Fewer sky columns than this share of the map: no usable edge (tunnel, canopy, looking down). */
const MIN_SKY_COLUMN_SHARE = 0.2;
/** A column's sky run must start in this top share of the map. */
const SKY_START_SHARE = 0.25;
/** Non-sky texels tolerated inside a sky run (a wire, a lamp head). */
const GAP_TEXELS = 2;

export interface SkyEdge {
    /** Map-space Y (top-origin, 0–1) of the median sky lower edge. */
    y: number;
    /** Share of columns that had a sky run. */
    coverage: number;
}

/** `texels`: the `rg8unorm` map (R = class id + 1). Null when the frame has no usable sky. */
export function skyLowerEdge(texels: ArrayLike<number>, width: number, height: number): SkyEdge | null {
    if (width <= 0 || height <= 0 || texels.length < width * height * 2) return null;
    const skyId = SemanticClass.sky + 1;
    const startLimit = Math.max(1, Math.floor(height * SKY_START_SHARE));
    const edges: number[] = [];
    for (let x = 0; x < width; x++) {
        let y = 0;
        while (y < startLimit && texels[(y * width + x) * 2] !== skyId) y++;
        if (y >= startLimit) continue;
        let last = y;
        let gap = 0;
        for (; y < height; y++) {
            if (texels[(y * width + x) * 2] === skyId) {
                last = y;
                gap = 0;
            } else if (++gap > GAP_TEXELS) {
                break;
            }
        }
        edges.push((last + 1) / height);
    }
    const coverage = edges.length / width;
    if (coverage < MIN_SKY_COLUMN_SHARE) return null;
    edges.sort((a, b) => a - b);
    const mid = edges.length >> 1;
    const y = edges.length % 2 ? edges[mid]! : (edges[mid - 1]! + edges[mid]!) / 2;
    return { y, coverage };
}
