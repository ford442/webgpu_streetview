import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GEOCODE_DENIED_MESSAGE,
  GEOCODE_DENIED_STATUS,
  isGeocodeDenied,
  noteGeocodeStatus,
  resetGeocodeAuthForTests,
  subscribeGeocodeDenied,
} from './geocodeAuth';

describe('geocodeAuth session circuit', () => {
  afterEach(() => {
    resetGeocodeAuthForTests();
    vi.restoreAllMocks();
  });

  it('ignores non-denied statuses', () => {
    expect(noteGeocodeStatus('OK')).toBe(false);
    expect(noteGeocodeStatus('ZERO_RESULTS')).toBe(false);
    expect(noteGeocodeStatus('OVER_QUERY_LIMIT')).toBe(false);
    expect(isGeocodeDenied()).toBe(false);
  });

  it('trips once on REQUEST_DENIED, warns without a key, and stays tripped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = 'AIzaSyTESTKEY_must_not_appear';
    window.MAPS_API_KEY = key;

    expect(noteGeocodeStatus(GEOCODE_DENIED_STATUS)).toBe(true);
    expect(isGeocodeDenied()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(GEOCODE_DENIED_MESSAGE);
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/AIza/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(key);
    expect(GEOCODE_DENIED_MESSAGE).not.toMatch(/cruise/i);

    noteGeocodeStatus(GEOCODE_DENIED_STATUS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers once when the circuit trips', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listener = vi.fn();
    const unsub = subscribeGeocodeDenied(listener);
    noteGeocodeStatus('REQUEST_DENIED');
    expect(listener).toHaveBeenCalledTimes(1);
    noteGeocodeStatus('REQUEST_DENIED');
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('resetGeocodeAuthForTests clears the circuit', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    noteGeocodeStatus('REQUEST_DENIED');
    resetGeocodeAuthForTests();
    expect(isGeocodeDenied()).toBe(false);
  });
});
