/**
 * How a hold release reveals the new panorama: the year-chip wipe, the
 * reduced-motion cut, or (anything else) the usual crossfade.
 */
import React, { act } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreetViewProvider, useStreetView } from '../useStreetView';
import { HISTORICAL_WIPE_DURATION_MS } from '../../renderer/historicalWipe';

let panoChanged: (() => void) | null = null;

const mockPano = {
  setPov: vi.fn(),
  setZoom: vi.fn(),
  setPano: vi.fn(),
  setPosition: vi.fn(),
  getLinks: () => [],
  getZoom: () => 1,
  getPano: () => 'year-2011',
  getLocation: () => null,
  getPosition: () => null,
  // Not OK → the stability gate force-releases on its first tick, no canvas needed.
  getStatus: () => 'ZERO_RESULTS',
  addListener: vi.fn((event: string, fn: () => void) => {
    if (event === 'pano_changed') panoChanged = fn;
    return {};
  }),
} as unknown as google.maps.StreetViewPanorama;

function makeRenderer(opts: { wipe?: boolean } = {}) {
  return {
    backendType: 'webgpu' as const,
    beginHoldTransition: vi.fn(),
    endHoldTransition: vi.fn(),
    setTransitionProgress: vi.fn(),
    isHoldActive: () => false,
    beginHistoricalWipe: vi.fn(() => opts.wipe !== false),
    setHistoricalWipeProgress: vi.fn(),
    endHistoricalWipe: vi.fn(),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <StreetViewProvider initialHeading={0} initialPitch={0}>{children}</StreetViewProvider>;
}

function hop(renderer: ReturnType<typeof makeRenderer>, reveal?: Parameters<ReturnType<typeof useStreetView>['teleportToPano']>[1]) {
  const hook = renderHook(() => useStreetView(), { wrapper });
  act(() => {
    hook.result.current.setPanorama(mockPano);
    hook.result.current.setRenderer(renderer as never);
  });
  act(() => {
    hook.result.current.teleportToPano('year-2011', reveal);
  });
  expect(hook.result.current.isTransitioning).toBe(true);
  // pano_changed → the first stability tick force-releases.
  act(() => {
    panoChanged!();
    vi.advanceTimersByTime(500);
  });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  (globalThis as unknown as { google: unknown }).google = { maps: { event: { removeListener: vi.fn() } } };
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  panoChanged = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useStreetView release reveal', () => {
  it('reduced-motion cut: releases at once with no shader and no crossfade', () => {
    const renderer = makeRenderer();
    const { result } = hop(renderer, { reveal: { kind: 'cut' } });

    expect(renderer.endHoldTransition).toHaveBeenCalled();
    expect(result.current.isTransitioning).toBe(false);
    expect(renderer.beginHistoricalWipe).not.toHaveBeenCalled();
    expect(renderer.setHistoricalWipeProgress).not.toHaveBeenCalled();
    // Only the reset to 0 — no 0→1 ramp.
    expect(renderer.setTransitionProgress.mock.calls.every(([p]) => p === 0)).toBe(true);
  });

  it('year-chip wipe: ramps the wipe, not the crossfade, then ends it', () => {
    const renderer = makeRenderer();
    const { result } = hop(renderer, { reveal: { kind: 'wipe', direction: -1 } });

    expect(renderer.beginHistoricalWipe).toHaveBeenCalledWith(-1);
    act(() => {
      vi.advanceTimersByTime(HISTORICAL_WIPE_DURATION_MS + 100);
    });
    const progress = renderer.setHistoricalWipeProgress.mock.calls.map(([p]) => p as number);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toBe(1);
    expect(renderer.setTransitionProgress.mock.calls.every(([p]) => p === 0)).toBe(true);
    expect(renderer.endHistoricalWipe).toHaveBeenCalled();
    expect(result.current.isTransitioning).toBe(false);
  });

  it('falls back to the crossfade when the renderer declines the wipe', () => {
    const renderer = makeRenderer({ wipe: false });
    hop(renderer, { reveal: { kind: 'wipe', direction: 1 } });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(renderer.setHistoricalWipeProgress).not.toHaveBeenCalled();
    expect(renderer.setTransitionProgress.mock.calls.some(([p]) => p > 0 && p <= 1)).toBe(true);
  });

  it('a plain hop keeps the crossfade', () => {
    const renderer = makeRenderer();
    hop(renderer);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(renderer.beginHistoricalWipe).not.toHaveBeenCalled();
    expect(renderer.setTransitionProgress.mock.calls.some(([p]) => p > 0)).toBe(true);
  });
});
