import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isGeocodeDenied, resetGeocodeAuthForTests } from '../search/geocodeAuth';
import {
  getPanoLocationBase,
  resetPanoLocationForTests,
  resolvePanoLocation,
} from './panoLocation';

function installMaps(geocode: ReturnType<typeof vi.fn>) {
  (globalThis as unknown as { google: unknown }).google = {
    maps: {
      Geocoder: class {
        geocode = geocode;
      },
      LatLng: class {
        constructor(
          public latV: number,
          public lngV: number,
        ) {}
        lat() {
          return this.latV;
        }
        lng() {
          return this.lngV;
        }
      },
      StreetViewService: class {
        getPanorama(
          _req: unknown,
          cb: (data: null, status: string) => void,
        ) {
          cb(null, 'UNKNOWN_ERROR');
        }
      },
    },
  };
}

function makePano(id: string) {
  const latLng = { lat: () => 37.8, lng: () => -122.2 };
  return {
    getPano: () => id,
    getPosition: () => latLng,
    getLocation: () => ({ latLng, description: 'Market St' }),
  } as unknown as google.maps.StreetViewPanorama;
}

describe('panoLocation', () => {
  beforeEach(() => {
    resetGeocodeAuthForTests();
    resetPanoLocationForTests();
    vi.restoreAllMocks();
  });

  it('HUD base uses getLocation().description and never calls Geocoder', () => {
    const geocode = vi.fn();
    installMaps(geocode);
    const info = getPanoLocationBase(makePano('pano-hud'));
    expect(info?.description).toBe('Market St');
    expect(info?.address).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });

  it('resolvePanoLocation default does not reverse-geocode (cruise/HUD/hops)', async () => {
    const geocode = vi.fn();
    installMaps(geocode);
    const info = await resolvePanoLocation(makePano('pano-hop'));
    expect(info?.description).toBe('Market St');
    expect(info?.address).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
    expect(isGeocodeDenied()).toBe(false);
  });

  it('includeAddress REQUEST_DENIED returns null address, trips circuit, skips further geocode', async () => {
    const key = 'AIzaSyTESTKEY_must_not_appear';
    window.MAPS_API_KEY = key;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const geocode = vi.fn((_req: unknown, cb: (r: null, s: string) => void) => {
      cb(null, 'REQUEST_DENIED');
    });
    installMaps(geocode);

    const info = await resolvePanoLocation(makePano('pano-denied-1'), { includeAddress: true });
    expect(info?.address).toBeNull();
    expect(isGeocodeDenied()).toBe(true);
    expect(geocode).toHaveBeenCalledTimes(1);

    const info2 = await resolvePanoLocation(makePano('pano-denied-2'), { includeAddress: true });
    expect(info2?.address).toBeNull();
    expect(geocode).toHaveBeenCalledTimes(1);

    const logged = warn.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain(key);
    expect(logged).not.toMatch(/AIza/);
  });

  it('includeAddress OK returns a formatted address', async () => {
    const geocode = vi.fn((_req: unknown, cb: (r: { formatted_address: string }[], s: string) => void) => {
      cb([{ formatted_address: '123 Main St' }], 'OK');
    });
    installMaps(geocode);
    const info = await resolvePanoLocation(makePano('pano-ok'), { includeAddress: true });
    expect(info?.address).toBe('123 Main St');
    expect(isGeocodeDenied()).toBe(false);
  });
});
