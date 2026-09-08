import React, { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreetViewProvider, useStreetView } from '../useStreetView';
import { STABILITY_MAX_WAIT_MS } from '../../utils/panoramaStability';

const forwardLink = { pano: 'next-pano', heading: 34, description: 'forward' };

let panoChangedHandler: (() => void) | null = null;
let currentPanoId = 'current-pano';

const mockPano = {
  setPov: vi.fn(),
  setZoom: vi.fn(),
  setPano: vi.fn((id: string) => {
    currentPanoId = id;
  }),
  setPosition: vi.fn(),
  getLinks: vi.fn(() => [forwardLink]),
  getZoom: () => 1,
  getPano: () => currentPanoId,
  getLocation: () => ({ description: 'Test' }),
  getPosition: () => null,
  addListener: vi.fn((event: string, handler: () => void) => {
    if (event === 'pano_changed') panoChangedHandler = handler;
    return {};
  }),
} as unknown as google.maps.StreetViewPanorama;

beforeAll(() => {
  (globalThis as { google?: unknown }).google = {
    maps: {
      event: {
        removeListener: vi.fn(),
      },
    },
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <StreetViewProvider initialHeading={34} initialPitch={10}>
      {children}
    </StreetViewProvider>
  );
}

describe('useStreetView navigationIdlePromise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panoChangedHandler = null;
    currentPanoId = 'current-pano';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when navigation is already idle', async () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });
    await act(async () => {
      await result.current.navigationIdlePromise();
    });
  });

  it('stays pending until navigation is idle after a hop', async () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
    });

    act(() => {
      result.current.advance('forward', 34);
      panoChangedHandler?.();
    });
    expect(result.current.isTransitioning).toBe(true);

    let idleResolved = false;
    const idleWait = result.current.navigationIdlePromise().then(() => {
      idleResolved = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(idleResolved).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STABILITY_MAX_WAIT_MS + 200);
    });

    await waitFor(() => {
      expect(result.current.isTransitioning).toBe(false);
    });

    await act(async () => {
      await idleWait;
    });
    expect(idleResolved).toBe(true);
  });
});
