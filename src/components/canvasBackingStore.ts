/**
 * Backing-store sizing for the WebGPU panorama canvas.
 *
 * The canvas used to be sized from `innerWidth × innerHeight` — CSS pixels. On
 * a HiDPI display the full-DPR Maps canvas was uploaded and then rendered at
 * 1× (blurry, and the extra upload bandwidth bought nothing), and a DPR change
 * (dragging the window to another monitor, browser zoom) was never seen.
 *
 * Now the CSS size stays 100% and the backing store follows a
 * `ResizeObserver`: `devicePixelContentBoxSize` when the browser reports it
 * (exact device pixels, no rounding drift), else `contentBoxSize ×
 * devicePixelRatio`. The DPR is capped by the quality tier and the result is
 * clamped to the device's `maxTextureDimension2D` — the swap chain *is* a
 * texture of this size.
 */
import { clampTextureSize } from '../renderer/deviceInit';

export interface CanvasBoxSize {
    cssWidth: number;
    cssHeight: number;
    /** From `devicePixelContentBoxSize`, when the browser reports it. */
    devicePixelWidth?: number;
    devicePixelHeight?: number;
}

export interface BackingStoreInput extends CanvasBoxSize {
    devicePixelRatio: number;
    /** Quality-tier ceiling on the DPR the canvas renders at. */
    dprCap: number;
    /** `device.limits.maxTextureDimension2D`, once a device exists. */
    maxTextureDimension: number;
}

export interface BackingStoreSize {
    width: number;
    height: number;
    /** The DPR actually applied after the tier cap and the texture clamp. */
    effectiveDpr: number;
}

/** Before a device exists: the core default. Re-resolved once the renderer reports its real limit. */
export const DEFAULT_MAX_TEXTURE_DIMENSION = 8192;

export function resolveBackingStoreSize(input: BackingStoreInput): BackingStoreSize {
    const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
    const cap = input.dprCap > 0 ? input.dprCap : 1;
    const applied = Math.min(dpr, cap);

    let width: number;
    let height: number;
    const devicePixels = devicePixelBox(input, dpr);
    if (devicePixels) {
        // Exact device pixels, scaled down only when the tier caps the DPR.
        const scale = applied / dpr;
        width = Math.round(devicePixels.width * scale);
        height = Math.round(devicePixels.height * scale);
    } else {
        width = Math.round(input.cssWidth * applied);
        height = Math.round(input.cssHeight * applied);
    }

    const fit = clampTextureSize(width, height, input.maxTextureDimension);
    const cssWidth = input.cssWidth > 0 ? input.cssWidth : 1;
    return {
        width: fit.width,
        height: fit.height,
        effectiveDpr: fit.width / cssWidth,
    };
}

/**
 * `devicePixelContentBoxSize` is exact where it is right, but it is not always
 * right: Chromium's device-scale emulation (and some embedders) report it at
 * the *physical* scale while `devicePixelRatio` reports the emulated one. A
 * box more than a pixel or two away from CSS × DPR is not a rounding
 * refinement, so it is ignored in favour of CSS × DPR.
 */
function devicePixelBox(input: BackingStoreInput, dpr: number): { width: number; height: number } | null {
    const width = input.devicePixelWidth;
    const height = input.devicePixelHeight;
    if (!width || !height) return null;
    const tolerance = Math.max(2, dpr);
    const agrees = Math.abs(width - input.cssWidth * dpr) <= tolerance
        && Math.abs(height - input.cssHeight * dpr) <= tolerance;
    return agrees ? { width, height } : null;
}

/** The quality tier's DPR ceiling. Never below 1: the canvas is never rendered under CSS size. */
export function dprCapForPixelRatio(presetPixelRatio: number): number {
    return Math.max(1, Number.isFinite(presetPixelRatio) ? presetPixelRatio : 1);
}

/** Read one `ResizeObserverEntry` into CSS + (when available) device-pixel sizes. */
export function readResizeEntry(entry: ResizeObserverEntry): CanvasBoxSize {
    const box = entry.contentBoxSize?.[0];
    const size: CanvasBoxSize = box
        ? { cssWidth: box.inlineSize, cssHeight: box.blockSize }
        : { cssWidth: entry.contentRect.width, cssHeight: entry.contentRect.height };
    const device = (entry as ResizeObserverEntry & {
        devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize>;
    }).devicePixelContentBoxSize?.[0];
    if (device) {
        size.devicePixelWidth = device.inlineSize;
        size.devicePixelHeight = device.blockSize;
    }
    return size;
}

/**
 * Observe `element` and report its box on every size or DPR change. Uses
 * `devicePixelContentBoxSize` where supported (it also fires on a pure DPR
 * change); elsewhere a `(resolution: Ndppx)` media query catches a DPR change
 * that leaves the CSS size alone (moving between monitors).
 */
export function observeCanvasBox(
    element: HTMLElement,
    onBox: (box: CanvasBoxSize) => void,
): () => void {
    let last: CanvasBoxSize | null = null;
    const report = (box: CanvasBoxSize) => {
        last = box;
        onBox(box);
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (entry) report(readResizeEntry(entry));
        });
        try {
            observer.observe(element, { box: 'device-pixel-content-box' });
        } catch {
            // Safari: no device-pixel-content-box — CSS box + DPR instead.
            observer.observe(element, { box: 'content-box' });
        }
    } else if (typeof window !== 'undefined') {
        const onResize = () => report({ cssWidth: window.innerWidth, cssHeight: window.innerHeight });
        window.addEventListener('resize', onResize);
        onResize();
        observer = { disconnect: () => window.removeEventListener('resize', onResize) } as ResizeObserver;
    }

    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
        armDprQuery();
        // Device-pixel sizes from the old DPR are stale; let the CSS box decide.
        if (last) report({ cssWidth: last.cssWidth, cssHeight: last.cssHeight });
    };
    const armDprQuery = () => {
        dprQuery?.removeEventListener?.('change', onDprChange);
        dprQuery = null;
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        try {
            dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            dprQuery.addEventListener?.('change', onDprChange);
        } catch {
            dprQuery = null;
        }
    };
    armDprQuery();

    return () => {
        observer?.disconnect();
        dprQuery?.removeEventListener?.('change', onDprChange);
    };
}
