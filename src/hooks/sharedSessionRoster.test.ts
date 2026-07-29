import { toSharedSessionParticipants, shouldRetryPeerConnection } from './sharedSessionRoster';
import type { PresenceEntry } from '../services/signaling/signalingClient';

describe('toSharedSessionParticipants', () => {
  it('marks the matching clientId as isSelf', () => {
    const entries: PresenceEntry[] = [
      { clientId: 'host-1', role: 'host' },
      { clientId: 'guest-1', role: 'guest' },
    ];
    const result = toSharedSessionParticipants(entries, 'guest-1');
    expect(result.find((p) => p.clientId === 'guest-1')?.isSelf).toBe(true);
    expect(result.find((p) => p.clientId === 'host-1')?.isSelf).toBe(false);
  });

  it('sorts the host first, then guests by clientId', () => {
    const entries: PresenceEntry[] = [
      { clientId: 'guest-2', role: 'guest' },
      { clientId: 'guest-1', role: 'guest' },
      { clientId: 'host-1', role: 'host' },
    ];
    const result = toSharedSessionParticipants(entries, 'host-1');
    expect(result.map((p) => p.clientId)).toEqual(['host-1', 'guest-1', 'guest-2']);
  });

  it('returns an empty list for an empty roster', () => {
    expect(toSharedSessionParticipants([], 'self')).toEqual([]);
  });
});

describe('shouldRetryPeerConnection', () => {
  it('retries a failed connection while the peer is still present', () => {
    expect(shouldRetryPeerConnection('failed', true, 0)).toBe(true);
    expect(shouldRetryPeerConnection('disconnected', true, 0)).toBe(true);
  });

  it('does not retry once the peer has left', () => {
    expect(shouldRetryPeerConnection('failed', false, 0)).toBe(false);
  });

  it('does not retry a healthy connection state', () => {
    expect(shouldRetryPeerConnection('connected', true, 0)).toBe(false);
    expect(shouldRetryPeerConnection('connecting', true, 0)).toBe(false);
    expect(shouldRetryPeerConnection('new', true, 0)).toBe(false);
  });

  it('stops retrying once the attempt budget is exhausted', () => {
    expect(shouldRetryPeerConnection('failed', true, 5)).toBe(false);
    expect(shouldRetryPeerConnection('failed', true, 4)).toBe(true);
  });

  it('respects a custom max-attempts budget', () => {
    expect(shouldRetryPeerConnection('failed', true, 2, 2)).toBe(false);
    expect(shouldRetryPeerConnection('failed', true, 1, 2)).toBe(true);
  });
});
