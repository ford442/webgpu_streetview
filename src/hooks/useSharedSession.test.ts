import { decodeSignal, encodeSignal, shouldApplyIncomingState, SessionState } from './useSharedSession';

describe('encodeSignal / decodeSignal', () => {
  it('round-trips an SDP description through a copy-pasteable code', () => {
    const description: RTCSessionDescriptionInit = { type: 'offer', sdp: 'v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n' };
    const code = encodeSignal(description);
    expect(typeof code).toBe('string');
    expect(decodeSignal(code)).toEqual(description);
  });

  it('tolerates surrounding whitespace from copy/paste', () => {
    const description: RTCSessionDescriptionInit = { type: 'answer', sdp: 'v=0\r\n' };
    const code = `  ${encodeSignal(description)}\n`;
    expect(decodeSignal(code)).toEqual(description);
  });

  it('rejects a code that is not a valid session description', () => {
    const bogus = btoa(JSON.stringify({ foo: 'bar' }));
    expect(() => decodeSignal(bogus)).toThrow('Invalid session code');
  });

  it('rejects a code that is not valid base64/JSON', () => {
    expect(() => decodeSignal('not-a-real-code')).toThrow();
  });
});

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
});
