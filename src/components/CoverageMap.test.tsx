// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadCesiumSDK = vi.fn(() => new Promise<void>(() => {}));
vi.mock('../hooks/useGlobeMode', () => ({ loadCesiumSDK: () => loadCesiumSDK() }));

import CoverageMap from './CoverageMap';
import { resetPanoGraphCacheForTests } from '../services/maps/panoCoverageGraph';
import { resetMapsCallBudgetForTests, getMapsCallBudget } from '../services/maps/callBudget';

const coverageLayerSetMap = vi.fn();
const coverageLayerCtor = vi.fn();
const mapCtor = vi.fn();
const getPanorama = vi.fn();

function installGoogle() {
  const listener = { remove: vi.fn() };
  (globalThis as { google?: unknown }).google = {
    maps: {
      Map: class {
        constructor(...args: unknown[]) { mapCtor(...args); }
        addListener() { return listener; }
        panTo() {}
      },
      Circle: class {
        addListener() { return listener; }
        setMap() {}
        setCenter() {}
      },
      StreetViewCoverageLayer: class {
        constructor() { coverageLayerCtor(); }
        setMap(m: unknown) { coverageLayerSetMap(m); }
      },
      StreetViewService: class {
        getPanorama(...args: unknown[]) { getPanorama(...args); }
      },
      StreetViewStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' },
      StreetViewSource: { OUTDOOR: 'outdoor' },
    },
  };
}

const panorama = {
  getPosition: () => ({ lat: () => 37.8, lng: () => -122.4 }),
  getPano: () => 'root',
  addListener: () => ({ remove: vi.fn() }),
} as unknown as google.maps.StreetViewPanorama;

function renderMap() {
  return render(
    <CoverageMap panorama={panorama} pois={[]} onTeleportPano={vi.fn()} onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  installGoogle();
  resetMapsCallBudgetForTests();
  resetPanoGraphCacheForTests();
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as { google?: unknown }).google;
});

describe('CoverageMap billing defaults', () => {
  it('opens a Google map with no coverage layer, no lookups and no 3D SDK', () => {
    renderMap();
    expect(mapCtor).toHaveBeenCalledTimes(1);
    expect(coverageLayerCtor).not.toHaveBeenCalled();
    expect(getPanorama).not.toHaveBeenCalled();
    expect(loadCesiumSDK).not.toHaveBeenCalled();
    expect(getMapsCallBudget().getStats().total).toBe(0);
  });

  it('attaches the coverage layer only while toggled on', () => {
    renderMap();
    const toggle = screen.getByRole('checkbox', { name: /Street View coverage/ });
    fireEvent.click(toggle);
    expect(coverageLayerCtor).toHaveBeenCalledTimes(1);
    expect(coverageLayerSetMap).toHaveBeenLastCalledWith(expect.anything());
    fireEvent.click(toggle);
    expect(coverageLayerSetMap).toHaveBeenLastCalledWith(null);
  });

  it('loads the 3D SDK only on switching mode, and walks links only when asked', async () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Cesium' }));
    expect(loadCesiumSDK).toHaveBeenCalledTimes(1);
    expect(getPanorama).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Linked panos/ }));
    });
    expect(getPanorama).toHaveBeenCalledWith({ pano: 'root' }, expect.any(Function));
    expect(getMapsCallBudget().getStats().bySource).toEqual({ 'coverage-graph': 1 });
  });

  it('keeps one Google map across mode flips', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Cesium' }));
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(mapCtor).toHaveBeenCalledTimes(1);
  });
});
