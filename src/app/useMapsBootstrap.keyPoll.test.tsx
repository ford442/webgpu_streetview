// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/maps/loader', () => ({
  clearAuthFailure: vi.fn(),
  loadMapsApi: vi.fn(() => Promise.resolve()),
  onMapsAuthFailure: vi.fn(() => () => {}),
  removeFailedBootstrap: vi.fn(),
}));

const keyState = { key: '' };
vi.mock('./mapsKeyUtils', () => ({
  getConfiguredMapsKey: () => keyState.key,
  INITIAL_MAPS_KEY: '',
}));

import { useMapsBootstrap } from './useMapsBootstrap';

/** Intervals created with the late-key poll's 120 ms period. */
function keyPolls(spy: { mock: { calls: readonly unknown[][] } }): number {
  return spy.mock.calls.filter((call) => call[1] === 120).length;
}

describe('useMapsBootstrap late-key poll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    keyState.key = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls until a key is found, then listens to the event only', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { result } = renderHook(() => useMapsBootstrap());
    expect(result.current.effectiveMapsKey).toBe('');
    expect(keyPolls(setIntervalSpy)).toBe(1);

    keyState.key = 'AIzaSyLateKeyForThePollTest';
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(result.current.effectiveMapsKey).toBe('AIzaSyLateKeyForThePollTest');
    expect(clearIntervalSpy).toHaveBeenCalled();
    const pollsAfterKey = keyPolls(setIntervalSpy);
    expect(pollsAfterKey).toBe(1);

    // A later key still lands through the config.js event.
    keyState.key = 'AIzaSyReplacementKeyViaEvent';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });
    expect(result.current.effectiveMapsKey).toBe('AIzaSyReplacementKeyViaEvent');
    expect(keyPolls(setIntervalSpy)).toBe(1);
  });
});
