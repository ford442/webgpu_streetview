import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useCruiseMode } from '../useCruiseMode';
import { noteGeocodeStatus, resetGeocodeAuthForTests } from '../../search/geocodeAuth';

/**
 * Cruise ticks are gear-aware: P/N park, D does one hop, 2/3 chain extra hops
 * within a single tick. These tests drive the tick timer directly.
 */

function makePanorama(panoIds: string[]) {
  let index = 0;
  return {
    pano: {
      getPano: () => panoIds[Math.min(index, panoIds.length - 1)],
      getPosition: () => null,
    } as unknown as google.maps.StreetViewPanorama,
    step: () => {
      index++;
    },
  };
}

function setup(hopsPerTick: () => number, panoIds: string[]) {
  const harness = makePanorama(panoIds);
  const advanceSafe = vi.fn(async () => {
    harness.step();
  });
  const view = renderHook(() =>
    useCruiseMode({
      panorama: harness.pano,
      advanceSafe,
      mapsAuthFailed: false,
      heading: 0,
      isTransitioning: false,
      setNavPending: () => {},
      hopsPerTick,
    })
  );
  return { advanceSafe, view };
}

/**
 * Fire exactly one cruise tick, then disengage so the interval stops before
 * letting the tick's chained hops settle (disengaging does not cancel the
 * in-flight chain, which is what we want to observe).
 */
async function runTick(view: { result: { current: { setIsCruiseMode: (v: boolean) => void } } }) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  act(() => view.result.current.setIsCruiseMode(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
}

describe('useCruiseMode gear-aware hops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('advances once per tick in D', async () => {
    const { advanceSafe, view } = setup(() => 1, ['a', 'b', 'c', 'd']);
    act(() => view.result.current.setIsCruiseMode(true));
    await runTick(view);
    expect(advanceSafe).toHaveBeenCalledTimes(1);
  });

  it('chains three hops in one tick in gear 3', async () => {
    const { advanceSafe, view } = setup(() => 3, ['a', 'b', 'c', 'd']);
    act(() => view.result.current.setIsCruiseMode(true));
    await runTick(view);
    expect(advanceSafe).toHaveBeenCalledTimes(3);
  });

  it('issues no hop while parked in P/N', async () => {
    const { advanceSafe, view } = setup(() => 0, ['a', 'b']);
    act(() => view.result.current.setIsCruiseMode(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000); // three parked ticks
    });
    expect(advanceSafe).not.toHaveBeenCalled();
    // Parked ticks are not "stuck" hops, so cruise stays engaged.
    expect(view.result.current.isCruiseMode).toBe(true);
  });

  it('stops the chain early at a dead end', async () => {
    // Pano id never changes → the first hop reports no movement.
    const { advanceSafe, view } = setup(() => 3, ['a']);
    act(() => view.result.current.setIsCruiseMode(true));
    await runTick(view);
    expect(advanceSafe).toHaveBeenCalledTimes(1);
  });

  it('aborts the remaining chain when the driver shifts to P mid-tick', async () => {
    let hops = 3;
    const { advanceSafe, view } = setup(() => hops, ['a', 'b', 'c', 'd']);
    act(() => view.result.current.setIsCruiseMode(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(1600); // first hop resolved
    });
    hops = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(advanceSafe).toHaveBeenCalledTimes(1);
  });
});

describe('useCruiseMode geocode denial is not a stuck hop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGeocodeAuthForTests();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    resetGeocodeAuthForTests();
  });

  it('keeps cruise on and does not count stuck hops when Geocoding is denied', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    noteGeocodeStatus('REQUEST_DENIED');

    const harness = makePanorama(['stuck']);
    const advanceSafe = vi.fn(async () => {});
    const view = renderHook(() =>
      useCruiseMode({
        panorama: harness.pano,
        advanceSafe,
        mapsAuthFailed: false,
        heading: 0,
        isTransitioning: false,
        setNavPending: () => {},
        hopsPerTick: () => 1,
      })
    );
    act(() => view.result.current.setIsCruiseMode(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(view.result.current.isCruiseMode).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(advanceSafe).toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls.flat().join('\n')).not.toMatch(/Hop did not advance/);
  });
});

