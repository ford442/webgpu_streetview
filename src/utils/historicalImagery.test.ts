import {
  offsetLatLng,
  buildSamplePoints,
  dedupeByDate,
  formatImageDate,
  pickHistoricalEntryForYear,
  readHistoricalCache,
  writeHistoricalCache,
  type HistoricalPanoEntry,
} from './historicalImagery';

describe('offsetLatLng', () => {
  it('moves north for bearing 0', () => {
    const { lat, lng } = offsetLatLng(0, 0, 100, 0);
    expect(lat).toBeGreaterThan(0);
    expect(lng).toBeCloseTo(0, 5);
  });

  it('moves east for bearing 90', () => {
    const { lat, lng } = offsetLatLng(0, 0, 100, 90);
    expect(lng).toBeGreaterThan(0);
    expect(lat).toBeCloseTo(0, 5);
  });

  it('returns the origin for zero distance', () => {
    const { lat, lng } = offsetLatLng(37.5, -122.3, 0, 45);
    expect(lat).toBeCloseTo(37.5, 6);
    expect(lng).toBeCloseTo(-122.3, 6);
  });
});

describe('buildSamplePoints', () => {
  it('includes the center point first', () => {
    const points = buildSamplePoints(10, 20);
    expect(points[0]).toEqual({ lat: 10, lng: 20 });
  });

  it('produces sampleCount + 1 points', () => {
    const points = buildSamplePoints(10, 20, { sampleCount: 6 });
    expect(points).toHaveLength(7);
  });

  it('spreads ring points away from the center', () => {
    const points = buildSamplePoints(10, 20, { radiusMeters: 25, sampleCount: 4 });
    for (const p of points.slice(1)) {
      expect(p.lat !== 10 || p.lng !== 20).toBe(true);
    }
  });
});

describe('dedupeByDate', () => {
  const entry = (panoId: string, imageDate: string): HistoricalPanoEntry => ({
    panoId,
    imageDate,
    lat: 0,
    lng: 0,
    copyright: null,
  });

  it('keeps only the first entry per distinct date', () => {
    const result = dedupeByDate([
      entry('a', '2020-01'),
      entry('b', '2020-01'),
      entry('c', '2021-06'),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.panoId)).toEqual(['a', 'c']);
  });

  it('drops entries with an empty imageDate', () => {
    const result = dedupeByDate([entry('a', ''), entry('b', '2022-03')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.panoId).toBe('b');
  });

  it('sorts chronologically ascending', () => {
    const result = dedupeByDate([
      entry('c', '2022-01'),
      entry('a', '2018-05'),
      entry('b', '2020-11'),
    ]);
    expect(result.map((e) => e.imageDate)).toEqual(['2018-05', '2020-11', '2022-01']);
  });

  it('returns an empty array for no entries', () => {
    expect(dedupeByDate([])).toEqual([]);
  });
});

describe('formatImageDate', () => {
  it('formats year-month into a readable label', () => {
    expect(formatImageDate('2022-05')).toBe('May 2022');
  });

  it('formats a year-only string', () => {
    expect(formatImageDate('2019')).toBe('2019');
  });

  it('passes through unrecognized formats untouched', () => {
    expect(formatImageDate('not-a-date')).toBe('not-a-date');
  });
});

describe('pickHistoricalEntryForYear', () => {
  const list: HistoricalPanoEntry[] = [
    { panoId: 'a', imageDate: '2012-06', lat: 0, lng: 0, copyright: null },
    { panoId: 'b', imageDate: '2019-03', lat: 0, lng: 0, copyright: null },
  ];

  it('matches YYYY prefix on imageDate', () => {
    expect(pickHistoricalEntryForYear(list, 2012)?.panoId).toBe('a');
    expect(pickHistoricalEntryForYear(list, '2019')?.panoId).toBe('b');
  });

  it('returns null for unknown years or junk', () => {
    expect(pickHistoricalEntryForYear(list, '1999')).toBeNull();
    expect(pickHistoricalEntryForYear(list, 'noir')).toBeNull();
    expect(pickHistoricalEntryForYear([], '2012')).toBeNull();
  });
});

describe('historical imagery localStorage cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is cached', () => {
    expect(readHistoricalCache(1, 2)).toBeNull();
  });

  it('round-trips entries through the cache', () => {
    const entries: HistoricalPanoEntry[] = [
      { panoId: 'p1', imageDate: '2021-01', lat: 1, lng: 2, copyright: '© Google' },
    ];
    writeHistoricalCache(1, 2, entries);
    expect(readHistoricalCache(1, 2)).toEqual(entries);
  });

  it('expires stale cache entries', () => {
    const entries: HistoricalPanoEntry[] = [
      { panoId: 'p1', imageDate: '2021-01', lat: 1, lng: 2, copyright: null },
    ];
    writeHistoricalCache(1, 2, entries);
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000; // 8 days later
    try {
      expect(readHistoricalCache(1, 2)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
