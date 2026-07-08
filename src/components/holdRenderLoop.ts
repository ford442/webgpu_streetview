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
}): boolean {
  if (opts.panoramaUpdatePaused) return true;
  // Full fps for the release crossfade after the hold lifts.
  if (opts.isTransitioning) return true;
  if (opts.skipFrame) return false;
  return (
    opts.sourceChanged ||
    opts.frameCount % opts.frameSkip === 0
  );
}

export function shouldBypassAdaptiveSkip(
  panoramaUpdatePaused: boolean,
  isTransitioning = false
): boolean {
  return panoramaUpdatePaused || isTransitioning;
}
