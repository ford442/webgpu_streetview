/**
 * Probe that the hold render loop always feeds fresh heading/pitch into renderHeldFrame.
 * (Full WebGPU path is not available in jsdom; this tests the loop policy in isolation.)
 */
export function shouldRenderHeldFrameThisTick(opts: {
  panoramaUpdatePaused: boolean;
  skipFrame: boolean;
  isTransitioning: boolean;
  sourceChanged: boolean;
  frameCount: number;
  frameSkip: number;
  /**
   * The renderer is drawing car mode's cabin into this frame
   * (`renderer/cabinComposite.ts`). The road frame is then the *only* thing
   * that presents the cabin, so skipping one also freezes the wipers, gauges
   * and rain overlay — which the second-canvas cabin never did, because the
   * browser composited it on its own clock.
   */
  cabinComposited?: boolean;
}): boolean {
  if (opts.panoramaUpdatePaused) return true;
  // Full fps for the release crossfade after the hold lifts.
  if (opts.isTransitioning) return true;
  if (opts.cabinComposited) return true;
  if (opts.skipFrame) return false;
  return (
    opts.sourceChanged ||
    opts.frameCount % opts.frameSkip === 0
  );
}

export function shouldBypassAdaptiveSkip(
  panoramaUpdatePaused: boolean,
  isTransitioning = false,
  cabinComposited = false,
): boolean {
  return panoramaUpdatePaused || isTransitioning || cabinComposited;
}
