/**
 * The WebXR layer the road frame presents into this display frame (#331).
 *
 * `xr/xrSession.ts` publishes it at the top of each `XRSession` animation
 * frame — the per-eye sub-image views are only valid inside that callback —
 * and retracts it at the end, so the renderer's tail (which runs inside the
 * same callback, after the car loop) draws each eye from the packed road
 * frame and composites the cabin's matching half over it. While a session is
 * presenting the canvas swap chain is left alone.
 *
 * One module instance across chunks, like `cabinOverlayRegistry` /
 * `roadFrameRegistry`: the session and the renderer must see the same slot.
 */
import type { Mat3, OutputFrustum } from './reproject/reprojectMath';

export interface XrEyeTarget {
    /** `subImage.colorTexture.createView(subImage.getViewDescriptor())`. */
    readonly view: GPUTextureView;
    readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    /** The eye's own frustum (from `XRView.projectionMatrix`). */
    readonly frustum: OutputFrustum;
    /** The eye's rotation in the road's world frame (car heading included). */
    readonly worldFromEye: Mat3;
    readonly eyeSign: -1 | 1;
    /** First draw into this texture layer this frame — may clear; later eyes load. */
    readonly clear: boolean;
}

export interface XrPresentFrame {
    readonly format: GPUTextureFormat;
    readonly eyes: readonly XrEyeTarget[];
    /** Half the distance between the eyes, metres. */
    readonly halfIpd: number;
}

let presenting = false;
let frame: XrPresentFrame | null = null;
let presentedFrames = 0;
let represent: (() => void) | null = null;

/** A session is presenting: every road frame splits so its tail can draw the eyes. */
export function setXrPresenting(on: boolean): void {
    presenting = on;
    if (!on) frame = null;
}

export function isXrPresenting(): boolean {
    return presenting;
}

export function publishXrPresentFrame(next: XrPresentFrame | null): void {
    frame = presenting ? next : null;
}

export function getXrPresentFrame(): XrPresentFrame | null {
    return frame;
}

/** The tail drew this frame's eyes (the session counts it as presented). */
export function noteXrFramePresented(): void {
    presentedFrames++;
}

export function getXrPresentedFrames(): number {
    return presentedFrames;
}

/**
 * The renderer's "draw the eyes again from the last packed road frame" — for
 * an XR frame in which no road frame was packed (no live source, a skipped
 * loop). The compositor needs the layer drawn every frame; re-aiming the last
 * frame at the new head pose is exactly what the tail does anyway.
 */
export function setXrRepresentHandler(handler: () => void): void {
    represent = handler;
}

/** Retract `handler` — only if it is still the registered one (a newer renderer may have replaced it). */
export function releaseXrRepresentHandler(handler: () => void): void {
    if (represent === handler) represent = null;
}

/** Draw this XR frame's eyes from the last road frame, if the renderer has one. */
export function representXrFrame(): void {
    represent?.();
}

export function resetXrPresentFrameForTests(): void {
    presenting = false;
    frame = null;
    presentedFrames = 0;
    represent = null;
}
