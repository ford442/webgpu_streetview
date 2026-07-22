import { resolveHistoricalAfterLabel } from './historicalExperience';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';

const entries: HistoricalPanoEntry[] = [
  {
    panoId: 'old',
    imageDate: '2019-03',
    lat: 0,
    lng: 0,
    copyright: null,
  },
  {
    panoId: 'new',
    imageDate: '2022-05',
    lat: 0,
    lng: 0,
    copyright: null,
  },
];

describe('resolveHistoricalAfterLabel', () => {
  it('returns Current when currentPanoId is missing', () => {
    expect(resolveHistoricalAfterLabel(entries, null)).toBe('Current');
    expect(resolveHistoricalAfterLabel(entries, undefined)).toBe('Current');
  });

  it('returns Current when pano is not in the timeline', () => {
    expect(resolveHistoricalAfterLabel(entries, 'unknown')).toBe('Current');
  });

  it('formats the matching entry date', () => {
    expect(resolveHistoricalAfterLabel(entries, 'new')).toBe('May 2022');
    expect(resolveHistoricalAfterLabel(entries, 'old')).toBe('Mar 2019');
  });
});
