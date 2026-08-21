import { describe, expect, it } from 'vitest';
import {
  GLOBE_DROP_ALTITUDE_M,
  GLOBE_ENTER_DURATION_S,
  GLOBE_EXIT_DURATION_S,
  GLOBE_ORBIT_ALTITUDE_M,
  GLOBE_STREET_ALTITUDE_M,
} from './globeCamera';
import { bookmarkLatLngFromPicked } from './globeInput';
import { appendGlobeWaypoint, canStartJourney, journeyPayload } from './globeJourney';

describe('globeCamera altitudes', () => {
  it('keeps enter orbit far above street / drop heights', () => {
    expect(GLOBE_STREET_ALTITUDE_M).toBe(120);
    expect(GLOBE_DROP_ALTITUDE_M).toBe(250);
    expect(GLOBE_ORBIT_ALTITUDE_M).toBe(1_800_000);
    expect(GLOBE_ORBIT_ALTITUDE_M).toBeGreaterThan(GLOBE_DROP_ALTITUDE_M);
    expect(GLOBE_ENTER_DURATION_S).toBeGreaterThan(GLOBE_EXIT_DURATION_S);
  });
});

describe('globeInput bookmark pick', () => {
  it('reads bookmarkLat/Lng from entity properties', () => {
    const picked = {
      id: {
        properties: {
          bookmarkLat: { getValue: () => 37.8 },
          bookmarkLng: { getValue: () => -122.4 },
        },
      },
    };
    expect(bookmarkLatLngFromPicked(picked)).toEqual({ lat: 37.8, lng: -122.4 });
  });

  it('returns null when properties are missing', () => {
    expect(bookmarkLatLngFromPicked(undefined)).toBeNull();
    expect(bookmarkLatLngFromPicked({})).toBeNull();
    expect(bookmarkLatLngFromPicked({ id: {} })).toBeNull();
  });
});

describe('globeJourney waypoints', () => {
  it('appends and builds the Start Journey payload', () => {
    const next = appendGlobeWaypoint([], { lat: 1, lng: 2 });
    const two = appendGlobeWaypoint(next, { lat: 3, lng: 4 });
    expect(canStartJourney([])).toBe(false);
    expect(canStartJourney(two)).toBe(true);
    expect(journeyPayload(two)).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });
});
