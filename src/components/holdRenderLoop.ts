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
  if (opts.skipFrame) return false;
  return (
    opts.isTransitioning ||
    opts.sourceChanged ||
    opts.frameCount % opts.frameSkip === 0
  );
}

export function shouldBypassAdaptiveSkip(panoramaUpdatePaused: boolean): boolean {
  return panoramaUpdatePaused;
}
