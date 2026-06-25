import { shouldBypassAdaptiveSkip, shouldRenderHeldFrameThisTick } from './holdRenderLoop';

describe('holdRenderLoop', () => {
  it('never skips adaptive frame drops while hold look-around is active', () => {
    expect(shouldBypassAdaptiveSkip(true)).toBe(true);
    expect(shouldBypassAdaptiveSkip(false)).toBe(false);
  });

  it('always renders held frames each tick during pause even when adaptive skip is on', () => {
    expect(
      shouldRenderHeldFrameThisTick({
        panoramaUpdatePaused: true,
        skipFrame: true,
        isTransitioning: true,
        sourceChanged: false,
        frameCount: 1,
        frameSkip: 2,
      })
    ).toBe(true);
  });

  it('allows adaptive skip when not paused', () => {
    expect(
      shouldRenderHeldFrameThisTick({
        panoramaUpdatePaused: false,
        skipFrame: true,
        isTransitioning: false,
        sourceChanged: false,
        frameCount: 1,
        frameSkip: 2,
      })
    ).toBe(false);
  });
});
