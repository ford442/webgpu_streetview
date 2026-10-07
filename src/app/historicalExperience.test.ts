import {
  compareStillScopeLabel,
  resolveHistoricalAfterLabel,
  resolveYearChipReveal,
} from './historicalExperience';
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

describe('resolveYearChipReveal', () => {
  const noOsPreference = () => false;

  it('wipes forward to a later year and back to an earlier one', () => {
    expect(resolveYearChipReveal(entries, 0, entries[1]!, false, noOsPreference)).toEqual({ kind: 'wipe', direction: 1 });
    expect(resolveYearChipReveal(entries, 1, entries[0]!, false, noOsPreference)).toEqual({ kind: 'wipe', direction: -1 });
  });

  it('treats an off-strip live pano as the newest chip, like the strip does', () => {
    expect(resolveYearChipReveal(entries, -1, entries[0]!, false, noOsPreference)).toEqual({ kind: 'wipe', direction: -1 });
  });

  it('cuts under the app reduced-motion setting or the OS preference', () => {
    expect(resolveYearChipReveal(entries, 0, entries[1]!, true, noOsPreference)).toEqual({ kind: 'cut' });
    expect(resolveYearChipReveal(entries, 0, entries[1]!, false, () => true)).toEqual({ kind: 'cut' });
  });
});

describe('compareStillScopeLabel', () => {
  it('states the rule before any compare', () => {
    expect(compareStillScopeLabel(null)).toMatch(/cabin when car mode draws it in-frame/);
  });

  it('keeps the road-only label when neither still was composited', () => {
    expect(compareStillScopeLabel({ beforeIncludesCabin: false, afterIncludesCabin: false }))
      .toBe('Compare stills show the road view only (no cabin).');
  });

  it('says the cabin is in when both were composited', () => {
    expect(compareStillScopeLabel({ beforeIncludesCabin: true, afterIncludesCabin: true })).toMatch(/include the cabin/);
  });

  it('is honest about a mixed pair', () => {
    expect(compareStillScopeLabel({ beforeIncludesCabin: true, afterIncludesCabin: false })).toMatch(/One compare still/);
  });
});
