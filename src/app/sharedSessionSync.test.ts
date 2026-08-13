import {
  buildHostBroadcastPayload,
  shouldTeleportGuestToPano,
  type HostBroadcastPanorama,
} from './sharedSessionSync';

function mockPanorama(opts: {
  panoId?: string | null;
  lat?: number;
  lng?: number;
  missingPos?: boolean;
}): HostBroadcastPanorama {
  return {
    getPano: () => opts.panoId ?? null,
    getPosition: () =>
      opts.missingPos
        ? null
        : {
            lat: () => opts.lat ?? 37.0,
            lng: () => opts.lng ?? -122.0,
          },
  };
}

describe('buildHostBroadcastPayload', () => {
  const pov = { heading: 90, pitch: 5, zoom: 1 };
  const viewMode = 'freelook' as const;

  it('returns null when panorama is missing', () => {
    expect(buildHostBroadcastPayload(null, pov, viewMode)).toBeNull();
    expect(buildHostBroadcastPayload(undefined, pov, viewMode)).toBeNull();
  });

  it('returns null when pano id is missing', () => {
    expect(buildHostBroadcastPayload(mockPanorama({ panoId: null }), pov, viewMode)).toBeNull();
  });

  it('returns null when position is missing', () => {
    expect(
      buildHostBroadcastPayload(mockPanorama({ panoId: 'abc', missingPos: true }), pov, viewMode),
    ).toBeNull();
  });

  it('builds payload from pano, pov, and viewMode', () => {
    expect(
      buildHostBroadcastPayload(
        mockPanorama({ panoId: 'pano-1', lat: 40.1, lng: -74.2 }),
        pov,
        'car',
      ),
    ).toEqual({
      panoId: 'pano-1',
      position: { lat: 40.1, lng: -74.2 },
      pov,
      viewMode: 'car',
    });
  });

  it('includes weatherPreset when provided in extras', () => {
    expect(
      buildHostBroadcastPayload(
        mockPanorama({ panoId: 'pano-1' }),
        pov,
        viewMode,
        { weatherPreset: 'tod:night|rain:0.50' },
      ),
    ).toEqual({
      panoId: 'pano-1',
      position: { lat: 37, lng: -122 },
      pov,
      viewMode: 'freelook',
      weatherPreset: 'tod:night|rain:0.50',
    });
  });
});

describe('shouldTeleportGuestToPano', () => {
  it('returns false when incoming pano is missing', () => {
    expect(shouldTeleportGuestToPano(null, 'a', null)).toBe(false);
    expect(shouldTeleportGuestToPano(undefined, 'a', null)).toBe(false);
    expect(shouldTeleportGuestToPano('', 'a', null)).toBe(false);
  });

  it('returns false when already on that pano', () => {
    expect(shouldTeleportGuestToPano('pano-1', 'pano-1', null)).toBe(false);
  });

  it('returns false when that pano was already applied', () => {
    expect(shouldTeleportGuestToPano('pano-1', 'pano-0', 'pano-1')).toBe(false);
  });

  it('returns true for a new pano not yet applied', () => {
    expect(shouldTeleportGuestToPano('pano-2', 'pano-1', 'pano-0')).toBe(true);
    expect(shouldTeleportGuestToPano('pano-2', null, null)).toBe(true);
  });
});
