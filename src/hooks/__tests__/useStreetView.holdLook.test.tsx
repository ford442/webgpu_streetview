import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { StreetViewProvider, useStreetView } from '../useStreetView';

const mockBeginHoldTransition = jest.fn();
const mockSetPov = jest.fn();
const mockSetPano = jest.fn();
const mockSetPosition = jest.fn();

const forwardLink = { pano: 'next-pano', heading: 34, description: 'forward' };
const mockGetLinks = jest.fn(() => [forwardLink]);

const mockPano = {
  setPov: mockSetPov,
  setZoom: jest.fn(),
  setPano: mockSetPano,
  setPosition: mockSetPosition,
  getLinks: mockGetLinks,
  getZoom: () => 1,
  getPano: () => 'current-pano',
  addListener: jest.fn(() => ({})),
} as unknown as google.maps.StreetViewPanorama;

const mockRenderer = {
  beginHoldTransition: mockBeginHoldTransition,
  endHoldTransition: jest.fn(),
  setTransitionProgress: jest.fn(),
  isHoldActive: () => true,
  backendType: 'webgpu' as const,
};

beforeAll(() => {
  (global as any).google = {
    maps: {
      event: {
        removeListener: jest.fn(),
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

describe('useStreetView hold look-around', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLinks.mockReturnValue([forwardLink]);
  });

  it('does not call setPov on the loading panorama while hold is active', () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
      result.current.setRenderer(mockRenderer as any);
      result.current.advance('forward');
    });

    expect(mockSetPano).toHaveBeenCalledWith('next-pano');
    expect(result.current.isPanoramaUpdatePaused).toBe(true);
    mockSetPov.mockClear();

    act(() => {
      result.current.setHeading(64);
      result.current.setPitch(20);
    });

    expect(mockSetPov).not.toHaveBeenCalled();
    expect(result.current.heading).toBe(64);
    expect(result.current.pitch).toBe(20);
  });

  it('snapshots hold baseline from view heading/pitch, not car navigation heading', () => {
    mockGetLinks.mockReturnValue([{ pano: 'next-pano', heading: 200, description: 'forward' }]);
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
      result.current.setRenderer(mockRenderer as any);
      result.current.setHeading(50);
      result.current.setPitch(12);
    });

    act(() => {
      result.current.advance('forward', 200);
    });

    expect(mockBeginHoldTransition).toHaveBeenCalledWith(50, 12, undefined);
  });

  it('syncs setPov when look changes outside of hold', () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
    });

    mockSetPov.mockClear();

    act(() => {
      result.current.setHeading(40);
    });

    expect(mockSetPov).toHaveBeenCalledWith({ heading: 40, pitch: 10 });
  });

  it('teleport() arms the same hold-pause as advance(), so MiniMap/autopilot jumps never flash blurry tiles', () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
      result.current.setRenderer(mockRenderer as any);
      result.current.setHeading(50);
      result.current.setPitch(12);
    });

    act(() => {
      result.current.teleport(1.23, 4.56);
    });

    expect(mockBeginHoldTransition).toHaveBeenCalledWith(50, 12, undefined);
    expect(mockSetPosition).toHaveBeenCalledWith({ lat: 1.23, lng: 4.56 });
    expect(result.current.isPanoramaUpdatePaused).toBe(true);
  });

  it('teleport() is a no-op while already transitioning, like advance()', () => {
    const { result } = renderHook(() => useStreetView(), { wrapper });

    act(() => {
      result.current.setPanorama(mockPano);
      result.current.setRenderer(mockRenderer as any);
      result.current.advance('forward');
    });

    mockSetPosition.mockClear();
    mockBeginHoldTransition.mockClear();

    act(() => {
      result.current.teleport(9.9, 9.9);
    });

    expect(mockSetPosition).not.toHaveBeenCalled();
    expect(mockBeginHoldTransition).not.toHaveBeenCalled();
  });
});
