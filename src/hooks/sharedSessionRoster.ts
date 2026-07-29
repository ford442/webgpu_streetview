import type { PresenceEntry } from '../services/signaling/signalingClient';

export interface SharedSessionParticipant extends PresenceEntry {
  isSelf: boolean;
}

/** Presence roster -> UI-ready participant list, host first then by clientId. */
export function toSharedSessionParticipants(
  entries: PresenceEntry[],
  selfClientId: string,
): SharedSessionParticipant[] {
  return entries
    .map((entry) => ({ ...entry, isSelf: entry.clientId === selfClientId }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
      return a.clientId.localeCompare(b.clientId);
    });
}

/**
 * Whether a dropped WebRTC peer connection should be automatically
 * re-negotiated. Only retry while the peer is still present in the room's
 * presence roster (they haven't explicitly left) and we haven't exceeded the
 * retry budget — a permanently-unreachable peer (e.g. symmetric NAT with no
 * TURN server) would otherwise retry forever.
 */
export function shouldRetryPeerConnection(
  connectionState: RTCPeerConnectionState,
  peerStillPresent: boolean,
  attemptsSoFar: number,
  maxAttempts = 5,
): boolean {
  if (attemptsSoFar >= maxAttempts) return false;
  return (connectionState === 'failed' || connectionState === 'disconnected') && peerStillPresent;
}
