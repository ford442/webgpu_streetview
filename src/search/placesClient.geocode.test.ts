import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteGeocodeStatus, resetGeocodeAuthForTests } from './geocodeAuth';
import { geocodeTextQuery } from './placesClient';
import { resetPlaceSearchBudgetForTests } from './placeSearchBudget';

describe('geocodeTextQuery REQUEST_DENIED', () => {
  afterEach(() => {
    resetGeocodeAuthForTests();
    resetPlaceSearchBudgetForTests();
    vi.restoreAllMocks();
    delete (globalThis as { google?: unknown }).google;
  });

  it('skips Geocoder after the session circuit trips', async () => {
    const geocode = vi.fn();
    (globalThis as unknown as { google: unknown }).google = {
      maps: {
        Geocoder: class {
          geocode = geocode;
        },
      },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    noteGeocodeStatus('REQUEST_DENIED');

    const result = await geocodeTextQuery('Paris');
    expect(result).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });
});
