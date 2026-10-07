import { isRegionChange, shouldRequeryRadio } from './tripRadio';

const edinburgh = { lat: 55.9533, lng: -3.1883 };
const glencoe = { lat: 56.6826, lng: -5.1023 }; // ~140 km
const leith = { lat: 55.9756, lng: -3.1665 };   // ~3 km

describe('trip-aware radio', () => {
  it('re-queries only after more than 50 km, and never for a pinned station', () => {
    expect(shouldRequeryRadio(edinburgh, leith, false)).toBe(false);
    expect(shouldRequeryRadio(edinburgh, glencoe, false)).toBe(true);
    expect(shouldRequeryRadio(edinburgh, glencoe, true)).toBe(false);
    expect(shouldRequeryRadio(null, glencoe, false)).toBe(false);
  });

  it('retunes on a country or state change, not for the same region', () => {
    const playing = { id: 'a', country: 'United Kingdom', state: 'Edinburgh' };
    expect(isRegionChange(playing, { id: 'b', country: 'United Kingdom', state: 'Highland' })).toBe(true);
    expect(isRegionChange(playing, { id: 'b', country: 'Ireland', state: '' })).toBe(true);
    expect(isRegionChange(playing, { id: 'b', country: 'united kingdom ', state: 'edinburgh' })).toBe(false);
    expect(isRegionChange(playing, { id: 'b', country: 'United Kingdom', state: '' })).toBe(false);
    expect(isRegionChange(playing, { id: 'a', country: 'Ireland', state: '' })).toBe(false);
    expect(isRegionChange(playing, { id: 'b', country: '', state: '' })).toBe(false);
  });
});
