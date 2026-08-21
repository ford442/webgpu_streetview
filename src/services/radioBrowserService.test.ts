import { describe, expect, it } from 'vitest';
import { mapStations } from './radioBrowserService';

describe('mapStations', () => {
  it('maps Radio Browser JSON fields and ignores non-objects', () => {
    const stations = mapStations([
      {
        stationuuid: 'abc',
        name: 'KEXP',
        url: 'http://example/stream',
        url_resolved: 'https://example/stream',
        country: 'US',
        bitrate: 128,
        votes: 9,
      },
      'not-a-station',
      null,
    ]);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({
      id: 'abc',
      name: 'KEXP',
      urlResolved: 'https://example/stream',
      bitrate: 128,
      votes: 9,
    });
  });

  it('returns empty for non-arrays', () => {
    expect(mapStations(null)).toEqual([]);
    expect(mapStations({ name: 'nope' })).toEqual([]);
  });
});
