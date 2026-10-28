/**
 * Where the road frame's pixels come from. Today that is the scraped Maps
 * canvas (`mapsCanvasSource.ts`); a Map Tiles panorama (#342) or a replayed
 * `.svtrip` (#338) plug in behind the same interface, so the frame loop and
 * its change detection never learn which one is live.
 */
export type FrameSourceKind = 'maps-canvas';

export interface FrameSource {
    readonly kind: FrameSourceKind;
    /** What the renderer uploads this frame, or null while there is nothing yet. */
    element(): TexImageSource | null;
    /** Bumps whenever `element()` or its content changed meaningfully. */
    version(): number;
    /** Called after every `version()` bump. Returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}
