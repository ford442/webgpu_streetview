import { shouldBypassAdaptiveSkip, shouldRenderHeldFrameThisTick } from './holdRenderLoop';

describe('holdRenderLoop', () => {
  it('never skips adaptive frame drops while hold look-around is active', () => {
    expect(shouldBypassAdaptiveSkip(true)).toBe(true);
    expect(shouldBypassAdaptiveSkip(false)).toBe(false);
    expect(shouldBypassAdaptiveSkip(false, true)).toBe(true);
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

  it('never skips a road frame while the cabin is composited into it', () => {
    // The cabin no longer has a canvas of its own to animate on, so a skipped
    // road frame would freeze the wipers and gauges too.
    expect(shouldBypassAdaptiveSkip(false, false, true)).toBe(true);
    expect(
      shouldRenderHeldFrameThisTick({
        panoramaUpdatePaused: false,
        skipFrame: true,
        isTransitioning: false,
        sourceChanged: false,
        frameCount: 1,
        frameSkip: 2,
        cabinComposited: true,
      })
    ).toBe(true);
  });

  it('keeps the historical skip policy when the cabin is a second canvas', () => {
    expect(shouldBypassAdaptiveSkip(false, false, false)).toBe(false);
    expect(
      shouldRenderHeldFrameThisTick({
        panoramaUpdatePaused: false,
        skipFrame: false,
        isTransitioning: false,
        sourceChanged: false,
        frameCount: 1,
        frameSkip: 2,
        cabinComposited: false,
      })
    ).toBe(false);
  });

  it('keeps rendering during the release crossfade (transitioning but no longer paused)', () => {
    expect(
      shouldRenderHeldFrameThisTick({
        panoramaUpdatePaused: false,
        skipFrame: true,
        isTransitioning: true,
        sourceChanged: false,
        frameCount: 1,
        frameSkip: 2,
      })
    ).toBe(true);
  });
});
