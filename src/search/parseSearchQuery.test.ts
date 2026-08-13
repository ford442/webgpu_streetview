import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from './parseSearchQuery';

describe('parseSearchQuery', () => {
  it('returns empty for whitespace', () => {
    expect(parseSearchQuery('  ')).toEqual({ kind: 'empty' });
  });

  it('parses coordinate paste', () => {
    expect(parseSearchQuery('37.8199, -122.4783')).toEqual({
      kind: 'coordinates',
      lat: 37.8199,
      lng: -122.4783,
    });
    expect(parseSearchQuery('40.7128;-74.0060')).toEqual({
      kind: 'coordinates',
      lat: 40.7128,
      lng: -74.006,
    });
  });

  it('rejects out-of-range coordinates as text', () => {
    expect(parseSearchQuery('91, 0')).toEqual({ kind: 'text', query: '91, 0' });
  });

  it('parses pano ids and pano: prefix', () => {
    const id = 'abcdefghijklmnopqrstuv';
    expect(parseSearchQuery(id)).toEqual({ kind: 'pano', panoId: id });
    expect(parseSearchQuery(`pano:${id}`)).toEqual({ kind: 'pano', panoId: id });
  });

  it('parses deep-link URLs', () => {
    const parsed = parseSearchQuery(
      'https://test.1ink.us/streetview?lat=37.8&lng=-122.4&pano=abcdefghijklmnopqrstuv',
    );
    expect(parsed).toEqual({ kind: 'pano', panoId: 'abcdefghijklmnopqrstuv' });
  });

  it('treats place names as text (Places path)', () => {
    expect(parseSearchQuery('Golden Gate Bridge')).toEqual({
      kind: 'text',
      query: 'Golden Gate Bridge',
    });
  });
});
