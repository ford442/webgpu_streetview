import { resolveTimeZone, preloadTimeZoneLookup, resetPanoTimeZoneForTests } from './panoTimeZone';

describe('panoTimeZone (real @photostructure/tz-lookup)', () => {
  beforeEach(() => {
    resetPanoTimeZoneForTests();
  });

  it('resolves Lisbon and Tokyo', async () => {
    expect(await resolveTimeZone(38.7223, -9.1393)).toBe('Europe/Lisbon');
    expect(await resolveTimeZone(35.6762, 139.6503)).toBe('Asia/Tokyo');
  });

  it('returns null (never throws) for missing or invalid coordinates', async () => {
    expect(await resolveTimeZone(null, null)).toBeNull();
    expect(await resolveTimeZone(undefined, 10)).toBeNull();
    expect(await resolveTimeZone(10, null)).toBeNull();
    expect(await resolveTimeZone(Number.NaN, 10)).toBeNull();
    expect(await resolveTimeZone(10, Number.POSITIVE_INFINITY)).toBeNull();
    expect(await resolveTimeZone(91, 0)).toBeNull();
    expect(await resolveTimeZone(0, -181)).toBeNull();
  });

  it('preload never rejects and warms the lookup', async () => {
    await expect(preloadTimeZoneLookup()).resolves.toBeUndefined();
    expect(await resolveTimeZone(51.5074, -0.1278)).toBe('Europe/London');
  });
});

describe('panoTimeZone when the lookup chunk fails to load', () => {
  afterEach(() => {
    vi.doUnmock('@photostructure/tz-lookup');
    vi.resetModules();
  });

  it('resolves null without throwing, then retries on the next call', async () => {
    let factoryCalls = 0;
    vi.resetModules();
    vi.doMock('@photostructure/tz-lookup', () => {
      factoryCalls++;
      if (factoryCalls === 1) throw new Error('chunk load failed');
      return { default: () => 'Asia/Tokyo' };
    });
    const mod = await import('./panoTimeZone');

    expect(await mod.resolveTimeZone(35.68, 139.65)).toBeNull();
    await expect(mod.preloadTimeZoneLookup()).resolves.toBeUndefined();

    // The failure was not memoized: a later hop can still get a zone.
    expect(await mod.resolveTimeZone(35.68, 139.65)).toBe('Asia/Tokyo');
  });
});
