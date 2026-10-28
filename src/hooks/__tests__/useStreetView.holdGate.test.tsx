// @vitest-environment jsdom
/**
 * The hold-release gate reads the Maps canvas through the shared frame source:
 * the baseline is snapshotted when the hold arms, each 100 ms tick takes one
 * sample, and the hold releases only once the content left the baseline and
 * then held still for the required window.
 */
import React, { act } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fp = vi.hoisted(() => ({ value: 'A', calls: 0 }));
vi.mock('../../renderer/frameSource/canvasFingerprint', () => ({
  readCanvasFingerprint: () => {
    fp.calls += 1;
    return Promise.resolve(fp.value);
  },
}));

import { StreetViewProvider, useStreetView } from '../useStreetView';
import { mapsCanvasSource } from '../../renderer/frameSource/mapsCanvasSource';
import {
  STABILITY_MAX_WAIT_MS,
  STABILITY_POLL_INTERVAL_MS,
  STABILITY_REQUIRED_STABLE_MS,
} from '../../utils/panoramaStability';

let panoChanged: (() => void) | null = null;
const mockPano = {
  setPov: vi.fn(),
  setZoom: vi.fn(),
  setPano: vi.fn(),
  setPosition: vi.fn(),
  getLinks: () => [{ pano: 'next', heading: 0 }],
  getZoom: () => 1,
  getPano: () => 'next',
  getLocation: () => null,
  getPosition: () => null,
  getStatus: () => 'OK',
  addListener: vi.fn((event: string, fn: () => void) => {
    if (event === 'pano_changed') panoChanged = fn;
    return {};
  }),
} as unknown as google.maps.StreetViewPanorama;

function wrapper({ children }: { children: React.ReactNode }) {
  return <StreetViewProvider initialHeading={0} initialPitch={0}>{children}</StreetViewProvider>;
}

function mapsCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  return c;
}

beforeEach(() => {
  vi.useFakeTimers();
  mapsCanvasSource.reset();
  fp.value = 'A';
  fp.calls = 0;
  (globalThis as unknown as { google: unknown }).google = { maps: { event: { removeListener: vi.fn() } } };
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // The outgoing-frame snapshot canvas (jsdom has no 2D context).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  panoChanged = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function armHop() {
  const hook = renderHook(() => useStreetView(), { wrapper });
  act(() => {
    hook.result.current.setPanorama(mockPano);
    hook.result.current.setCanvas(mapsCanvas());
  });
  act(() => {
    hook.result.current.advance('forward', 0);
  });
  await act(async () => {
    panoChanged!();
    await Promise.resolve();
  });
  return hook;
}

describe('useStreetView hold gate', () => {
  it('holds while the canvas still shows the outgoing frame, then releases once new content is stable', async () => {
    const { result } = await armHop();
    expect(result.current.isTransitioning).toBe(true);
    // The baseline snapshot of the outgoing frame.
    expect(fp.calls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STABILITY_POLL_INTERVAL_MS * 4);
    });
    expect(result.current.isPanoramaReady).toBe(false);

    fp.value = 'B';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STABILITY_REQUIRED_STABLE_MS + STABILITY_POLL_INTERVAL_MS * 2);
    });
    expect(result.current.isPanoramaReady).toBe(true);
    // One sample per tick (no extra readbacks per tick), plus the baseline.
    const ticks = Math.floor((STABILITY_POLL_INTERVAL_MS * 6 + STABILITY_REQUIRED_STABLE_MS) / STABILITY_POLL_INTERVAL_MS);
    expect(fp.calls).toBeLessThanOrEqual(ticks + 1);
  });

  it('force-releases at the max wait when the content never leaves the baseline', async () => {
    const { result } = await armHop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STABILITY_MAX_WAIT_MS - STABILITY_POLL_INTERVAL_MS * 2);
    });
    expect(result.current.isPanoramaReady).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STABILITY_POLL_INTERVAL_MS * 3);
    });
    expect(result.current.isPanoramaReady).toBe(true);
  });
});
