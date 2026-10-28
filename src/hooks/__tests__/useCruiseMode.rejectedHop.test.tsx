// @vitest-environment jsdom
/**
 * A hop whose advance rejects is a stuck hop. It used to escape `hop()`'s
 * try/finally, skip the stuck counter, and leave cruise running forever.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { povStore } from '../../state/povStore';
import { useCruiseMode } from '../useCruiseMode';

beforeEach(() => {
  povStore.reset({ heading: 0 });
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCruiseMode rejected hops', () => {
  it('counts a rejected advance as stuck and auto-disables after three', async () => {
    const advanceSafe = vi.fn(() => Promise.reject(new Error('teleport failed')));
    const view = renderHook(() =>
      useCruiseMode({
        panorama: { getPano: () => 'a', getPosition: () => null } as unknown as google.maps.StreetViewPanorama,
        advanceSafe,
        mapsAuthFailed: false,
        isTransitioning: false,
        setNavPending: () => {},
        hopsPerTick: () => 1,
      }),
    );
    act(() => view.result.current.setIsCruiseMode(true));
    // The engage hop plus two ticks: three rejected hops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000 * 2 + 500);
    });
    expect(advanceSafe).toHaveBeenCalledTimes(3);
    expect(view.result.current.isCruiseMode).toBe(false);
    // Disabled: no further ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(advanceSafe).toHaveBeenCalledTimes(3);
  });
});
