import { LOOK_PACKS, lookPackToEnvPatch } from '../config/lookPacks';
import {
  buildLookUrl,
  hasLookSearchParams,
  parseLookParams,
  resolveLookSearch,
  resolveLookUrlParams,
} from './lookLink';

const BASE = 'https://test.1ink.us/streetview?lat=37.774900&lng=-122.419400';

describe('look URL params', () => {
  it('parses a named look', () => {
    expect(parseLookParams('?look=noir').look).toBe('noir');
    expect(parseLookParams('look=noir').look).toBe('noir');
    expect(parseLookParams('?look=sepia').look).toBeUndefined();
  });

  it('clamps slider overrides', () => {
    const parsed = parseLookParams('?rain=140&sat=9&temp=-3&wind=-200');
    expect(parsed.rain).toBe(100);
    expect(parsed.saturation).toBe(2);
    expect(parsed.temperature).toBe(-1);
    expect(parsed.wind).toBe(-100);
  });

  it('round-trips a named look with no overrides to ?look= only', () => {
    const state = lookPackToEnvPatch(LOOK_PACKS.noir);
    const url = buildLookUrl({ lookId: 'noir', state }, BASE);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('look')).toBe('noir');
    expect(parsed.searchParams.get('rain')).toBeNull();
    expect(parsed.searchParams.get('lat')).toBe('37.774900');
    const resolved = resolveLookUrlParams(parseLookParams(parsed.search));
    expect(resolved.rainIntensity).toBe(LOOK_PACKS.noir.rain);
    expect(resolved.saturation).toBe(LOOK_PACKS.noir.saturation);
    expect(resolved.headlightsOn).toBe(true);
  });

  it('round-trips look + rain override', () => {
    const state = { ...lookPackToEnvPatch(LOOK_PACKS.noir), rainIntensity: 40 };
    const url = buildLookUrl({ lookId: 'noir', state }, BASE);
    const search = new URL(url).search;
    expect(search).toContain('look=noir');
    expect(search).toContain('rain=40');
    const resolved = resolveLookSearch(search);
    expect(resolved?.lookId).toBe('noir');
    expect(resolved?.patch.rainIntensity).toBe(40);
    expect(resolved?.patch.tint).toBe(LOOK_PACKS.noir.tint);
  });

  it('round-trips a custom grade without a named look', () => {
    const state = {
      ...lookPackToEnvPatch(LOOK_PACKS.clear),
      rainIntensity: 40,
      saturation: 0.8,
      timeOfDay: 'night' as const,
      nightIntensity: 1,
      headlightsOn: true,
    };
    const url = buildLookUrl({ lookId: null, state }, BASE);
    const search = new URL(url).search;
    expect(search).not.toContain('look=');
    expect(search).toContain('rain=40');
    expect(search).toContain('tod=night');
    const resolved = resolveLookSearch(search);
    expect(resolved?.lookId).toBeNull();
    expect(resolved?.patch.rainIntensity).toBe(40);
    expect(resolved?.patch.saturation).toBeCloseTo(0.8);
    expect(resolved?.patch.timeOfDay).toBe('night');
    expect(resolved?.patch.headlightsOn).toBe(true);
  });

  it('preserves renderer flags while replacing stale look keys', () => {
    const state = lookPackToEnvPatch(LOOK_PACKS.arctic);
    const url = buildLookUrl(
      { lookId: 'arctic', state },
      'https://example.com/streetview?look=noir&rain=40&renderer=webgl',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('look')).toBe('arctic');
    expect(parsed.searchParams.get('rain')).toBeNull();
    expect(parsed.searchParams.get('renderer')).toBe('webgl');
  });

  it('hasLookSearchParams ignores location-only queries', () => {
    expect(hasLookSearchParams('?lat=1&lng=2')).toBe(false);
    expect(hasLookSearchParams('?look=noir')).toBe(true);
    expect(hasLookSearchParams('?rain=10')).toBe(true);
    expect(resolveLookSearch('?lat=1&lng=2')).toBeNull();
  });

  it('resolveLookEnv from URL matches pack math for every look id', () => {
    for (const pack of Object.values(LOOK_PACKS)) {
      const url = buildLookUrl({ lookId: pack.id, state: lookPackToEnvPatch(pack) }, BASE);
      const again = resolveLookSearch(new URL(url).search);
      expect(again?.lookId).toBe(pack.id);
      expect(again?.patch).toEqual(lookPackToEnvPatch(pack));
    }
  });
});
