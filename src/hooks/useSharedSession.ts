import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared Exploration Sessions — multiplayer Street View road trips.
 *
 * A host drives (cruise/autopilot/keyboard); guests follow with a synchronized
 * POV. Peer-to-peer over WebRTC, signaled by hand (no server): the host
 * generates an "invite code" (its SDP offer, base64-encoded) to share out of
 * band (chat, link, etc), the guest pastes it to generate a "join code"
 * (its SDP answer) to send back. Once the host applies the join code the
 * data channel opens and state starts flowing.
 *
 * See docs/feature_expansion_plan.md §14.3.
 */

export interface SessionState {
  panoId: string;
  position: { lat: number; lng: number };
  pov: { heading: number; pitch: number; zoom: number };
  viewMode: 'freelook' | 'car';
  weatherPreset?: string;
  seq: number;
}

export type SharedSessionRole = 'host' | 'guest' | null;

export type SharedSessionStatus =
  | 'idle'
  | 'creating-invite'
  | 'awaiting-join-code'
  | 'joining'
  | 'awaiting-connection'
  | 'connected'
  | 'disconnected'
  | 'error';

const DATA_CHANNEL_LABEL = 'streetview-sync';
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Serialize an SDP offer/answer into a copy-pasteable invite/join code. */
export function encodeSignal(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(description));
}

/** Parse a code produced by {@link encodeSignal} back into an SDP description. */
export function decodeSignal(code: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(atob(code.trim()));
  if (!parsed || typeof parsed.type !== 'string' || typeof parsed.sdp !== 'string') {
    throw new Error('Invalid session code');
  }
  return parsed as RTCSessionDescriptionInit;
}

/**
 * Guests apply state in sequence order only, so a message that arrives late
 * (out-of-order data channel delivery, retried send) never rolls the view
 * backwards.
 */
export function shouldApplyIncomingState(
  current: SessionState | null,
  incoming: SessionState
): boolean {
  if (!current) return true;
  return incoming.seq > current.seq;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface UseSharedSessionResult {
  role: SharedSessionRole;
  status: SharedSessionStatus;
  error: string | null;
  /** Host-generated code to share with guests (SDP offer). */
  inviteCode: string | null;
  /** Guest-generated code to send back to the host (SDP answer). */
  joinCode: string | null;
  /** Latest state received by a guest from the host. */
  latestState: SessionState | null;
  isConnected: boolean;
  /** Host: start a new session and generate an invite code. */
  startHosting: () => Promise<void>;
  /** Host: apply a join code pasted from a guest to complete the handshake. */
  admitGuest: (joinCode: string) => Promise<void>;
  /** Guest: consume a host invite code and generate a join code to send back. */
  joinWithInviteCode: (inviteCode: string) => Promise<void>;
  /** Host: broadcast the current view to all connected guests. */
  broadcastState: (state: Omit<SessionState, 'seq'>) => void;
  leaveSession: () => void;
}

export function useSharedSession(): UseSharedSessionResult {
  const [role, setRole] = useState<SharedSessionRole>(null);
  const [status, setStatus] = useState<SharedSessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [latestState, setLatestState] = useState<SessionState | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const seqRef = useRef(0);

  const teardown = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const attachDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      setIsConnected(true);
      setStatus('connected');
    };
    dc.onclose = () => {
      setIsConnected(false);
      setStatus('disconnected');
    };
    dc.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as SessionState;
        setLatestState((current) => (shouldApplyIncomingState(current, incoming) ? incoming : current));
      } catch {
        // Ignore malformed messages rather than crashing the session.
      }
    };
  }, []);

  const startHosting = useCallback(async () => {
    teardown();
    setError(null);
    setLatestState(null);
    seqRef.current = 0;
    setRole('host');
    setStatus('creating-invite');

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setIsConnected(false);
          setStatus('disconnected');
        }
      };

      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
      attachDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      setInviteCode(encodeSignal(pc.localDescription!));
      setStatus('awaiting-join-code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session');
      setStatus('error');
    }
  }, [attachDataChannel, teardown]);

  const admitGuest = useCallback(async (guestJoinCode: string) => {
    const pc = pcRef.current;
    if (!pc) {
      setError('No active session to admit a guest into');
      return;
    }
    try {
      const answer = decodeSignal(guestJoinCode);
      await pc.setRemoteDescription(answer);
      setStatus('awaiting-connection');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid join code');
      setStatus('error');
    }
  }, []);

  const joinWithInviteCode = useCallback(async (hostInviteCode: string) => {
    teardown();
    setError(null);
    setLatestState(null);
    setRole('guest');
    setStatus('joining');

    try {
      const offer = decodeSignal(hostInviteCode);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setIsConnected(false);
          setStatus('disconnected');
        }
      };
      pc.ondatachannel = (event) => attachDataChannel(event.channel);

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      setJoinCode(encodeSignal(pc.localDescription!));
      setStatus('awaiting-connection');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid invite code');
      setStatus('error');
    }
  }, [attachDataChannel, teardown]);

  const broadcastState = useCallback((state: Omit<SessionState, 'seq'>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;
    seqRef.current += 1;
    dc.send(JSON.stringify({ ...state, seq: seqRef.current }));
  }, []);

  const leaveSession = useCallback(() => {
    teardown();
    setRole(null);
    setStatus('idle');
    setError(null);
    setInviteCode(null);
    setJoinCode(null);
    setLatestState(null);
    setIsConnected(false);
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    role,
    status,
    error,
    inviteCode,
    joinCode,
    latestState,
    isConnected,
    startHosting,
    admitGuest,
    joinWithInviteCode,
    broadcastState,
    leaveSession,
  };
}
