import { shouldApplyIncomingState, type SessionState } from './useSharedSession';

describe('shouldApplyIncomingState', () => {
  const base: SessionState = {
    panoId: 'abc',
    position: { lat: 1, lng: 2 },
    pov: { heading: 0, pitch: 0, zoom: 1 },
    viewMode: 'freelook',
    seq: 5,
  };

  it('always applies the first state received', () => {
    expect(shouldApplyIncomingState(null, base)).toBe(true);
  });

  it('applies a newer sequence number', () => {
    const next = { ...base, seq: 6 };
    expect(shouldApplyIncomingState(base, next)).toBe(true);
  });

  it('rejects a stale or duplicate sequence number', () => {
    expect(shouldApplyIncomingState(base, { ...base, seq: 5 })).toBe(false);
    expect(shouldApplyIncomingState(base, { ...base, seq: 4 })).toBe(false);
  });

  it('still keys only on seq when film-set fields are present', () => {
    const withLook = { ...base, lookId: 'noir', vehicleType: 'convertible', seq: 5 };
    expect(shouldApplyIncomingState(base, withLook)).toBe(false);
    expect(shouldApplyIncomingState(base, { ...withLook, seq: 6 })).toBe(true);
  });
});
