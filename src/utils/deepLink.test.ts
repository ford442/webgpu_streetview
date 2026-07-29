import { buildDeepLinkUrl, parseDeepLinkParams } from './deepLink';

describe('buildDeepLinkUrl', () => {
    it('encodes lat/lng/heading/pitch/zoom into query params', () => {
        const url = buildDeepLinkUrl(
            { lat: 37.7749, lng: -122.4194, heading: 90, pitch: -5, zoom: 1.5 },
            'https://example.com/streetview',
        );
        const parsed = new URL(url);
        expect(parsed.searchParams.get('lat')).toBe('37.774900');
        expect(parsed.searchParams.get('lng')).toBe('-122.419400');
        expect(parsed.searchParams.get('heading')).toBe('90.0');
        expect(parsed.searchParams.get('pitch')).toBe('-5.0');
        expect(parsed.searchParams.get('zoom')).toBe('1.50');
        expect(parsed.searchParams.has('pano')).toBe(false);
    });

    it('includes panoId when provided', () => {
        const url = buildDeepLinkUrl(
            { lat: 0, lng: 0, heading: 0, pitch: 0, zoom: 1, panoId: 'abc123' },
            'https://example.com/streetview',
        );
        expect(new URL(url).searchParams.get('pano')).toBe('abc123');
    });

    it('overwrites existing query params on the base URL', () => {
        const url = buildDeepLinkUrl(
            { lat: 1, lng: 2, heading: 3, pitch: 4, zoom: 5 },
            'https://example.com/streetview?lat=999&foo=bar',
        );
        const parsed = new URL(url);
        expect(parsed.searchParams.get('lat')).toBe('1.000000');
        expect(parsed.searchParams.get('foo')).toBe('bar');
    });
});

describe('parseDeepLinkParams', () => {
    it('returns null when lat/lng are missing', () => {
        expect(parseDeepLinkParams('?heading=90')).toBeNull();
    });

    it('returns null when lat/lng are out of range', () => {
        expect(parseDeepLinkParams('?lat=999&lng=0')).toBeNull();
        expect(parseDeepLinkParams('?lat=0&lng=999')).toBeNull();
    });

    it('parses a full set of params', () => {
        const result = parseDeepLinkParams('?lat=37.7749&lng=-122.4194&heading=90&pitch=-5&zoom=1.5&pano=abc123');
        expect(result).toEqual({
            lat: 37.7749,
            lng: -122.4194,
            heading: 90,
            pitch: -5,
            zoom: 1.5,
            panoId: 'abc123',
        });
    });

    it('defaults heading/pitch/zoom when omitted', () => {
        const result = parseDeepLinkParams('?lat=1&lng=2');
        expect(result).toEqual({
            lat: 1,
            lng: 2,
            heading: 0,
            pitch: 0,
            zoom: 1,
            panoId: undefined,
        });
    });

    it('round-trips through buildDeepLinkUrl', () => {
        const url = buildDeepLinkUrl(
            { lat: 48.8584, lng: 2.2945, heading: 123.4, pitch: 12.3, zoom: 2, panoId: 'pano-xyz' },
            'https://example.com/streetview',
        );
        const search = new URL(url).search;
        const parsed = parseDeepLinkParams(search);
        expect(parsed?.lat).toBeCloseTo(48.8584, 5);
        expect(parsed?.lng).toBeCloseTo(2.2945, 5);
        expect(parsed?.heading).toBeCloseTo(123.4, 1);
        expect(parsed?.pitch).toBeCloseTo(12.3, 1);
        expect(parsed?.zoom).toBeCloseTo(2, 2);
        expect(parsed?.panoId).toBe('pano-xyz');
    });
});
