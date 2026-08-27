import { describe, it, expect } from 'vitest';
import { buildStudioShareUrl, parseStudioLinkParams, yearFromImageDate } from './studioLink';

describe('parseStudioLinkParams', () => {
  it('parses look, year, and vehicle', () => {
    expect(parseStudioLinkParams('?look=noir&year=2012&vehicle=convertible')).toEqual({
      lookId: 'noir',
      year: '2012',
      vehicleType: 'convertible',
    });
  });

  it('drops unknown look and vehicle', () => {
    expect(parseStudioLinkParams('?look=sepia&year=abcd&vehicle=hovercraft')).toEqual({
      lookId: undefined,
      year: undefined,
      vehicleType: undefined,
    });
  });
});

describe('buildStudioShareUrl', () => {
  it('round-trips look, year, and vehicle with location', () => {
    const url = buildStudioShareUrl(
      {
        lat: 35.66,
        lng: 139.7,
        heading: 90,
        pitch: 0,
        zoom: 1,
        panoId: 'tokyo-1',
        lookId: 'noir',
        year: '2012',
        vehicleType: 'convertible',
      },
      'https://example.com/streetview',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('pano')).toBe('tokyo-1');
    expect(parsed.searchParams.get('look')).toBe('noir');
    expect(parsed.searchParams.get('year')).toBe('2012');
    expect(parsed.searchParams.get('vehicle')).toBe('convertible');
    expect(parseStudioLinkParams(parsed.search)).toEqual({
      lookId: 'noir',
      year: '2012',
      vehicleType: 'convertible',
    });
  });

  it('encodes YYYY-MM imageDate as year=YYYY', () => {
    const url = buildStudioShareUrl(
      {
        lat: 1,
        lng: 2,
        heading: 0,
        pitch: 0,
        zoom: 1,
        year: '2012-06',
        vehicleType: 'sedan',
      },
      'https://example.com/streetview',
    );
    expect(new URL(url).searchParams.get('year')).toBe('2012');
  });

  it('omits junk look and vehicle from the URL', () => {
    const url = buildStudioShareUrl(
      {
        lat: 1,
        lng: 2,
        heading: 0,
        pitch: 0,
        zoom: 1,
        lookId: 'sepia-dream',
        vehicleType: 'spaceship',
      },
      'https://example.com/streetview',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has('look')).toBe(false);
    expect(parsed.searchParams.has('vehicle')).toBe(false);
  });
});

describe('yearFromImageDate', () => {
  it('extracts YYYY from YYYY-MM', () => {
    expect(yearFromImageDate('2012-06')).toBe('2012');
    expect(yearFromImageDate('2019')).toBe('2019');
    expect(yearFromImageDate(null)).toBeUndefined();
  });
});
