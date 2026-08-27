import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRoomSignalingClient,
  generateClientId,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  type PresenceEntry,
  type RoomSignalingClient,
  type SignalingMessage,
} from '../services/signaling/signalingClient';
import { getSignalingRealtimeClient } from '../services/signaling/supabaseRealtimeClient';
import {
  shouldRetryPeerConnection,
  toSharedSessionParticipants,
  type SharedSessionParticipant,
} from './sharedSessionRoster';
import { resolveIceServers } from '../utils/iceServers';

/**
 * Shared Exploration Sessions — multiplayer Street View road trips.
 *
 * A host drives (cruise/autopilot/keyboard); guests follow with a synchronized
 * POV. Media is peer-to-peer over WebRTC data channels (one per guest, hub
 * topology) — only *signaling* (SDP offer/answer + trickle ICE candidates)
 * goes through a short-lived Supabase Realtime room keyed by a 6-character
 * room code, replacing the old copy-paste-an-SDP-blob flow. No imagery and
 * no POV state ever touches the signaling channel — only handshake metadata.
 *
 * Rooms are pure Realtime channels: nothing is persisted server-side, so a
 * room "expires" the moment everyone leaves it — there is nothing left to
 * clean up.
 *
 * TURN is optional — configure via REACT_APP_TURN_* or runtime window.TURN_*
 * in public/config.js. See docs/SHARED_SESSIONS.md.
 *
 * See docs/feature_expansion_plan.md §14.3.
 */

export interface SessionState {
  panoId: string;
  position: { lat: number; lng: number };
  pov: { heading: number; pitch: number; zoom: number };
  viewMode: 'freelook' | 'car';
  weatherPreset?: string;
  /** Named look pack id (`noir`, …). Unknown ids are dropped by guests. */
  lookId?: string;
  /** Capture date from the historical archive, `YYYY-MM`. Sidecar; year change is the pano teleport. */
  imageDate?: string;
  /** VehicleManager SSOT. Unknown values are dropped by guests. */
  vehicleType?: string;
  cabinView?: 'driver' | 'chauffeur';
  /** Chassis yaw when viewMode is car. Guest head look stays local. */
  carHeading?: number;
  /** Informational host display cap; guests do not change their own HDR path. */
  hdr?: boolean;
  seq: number;
}

export type SharedSessionRole = 'host' | 'guest' | null;

export type SharedSessionStatus =
  | 'idle'
  | 'creating-room'
  | 'awaiting-guests'
  | 'joining-room'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'host-left'
  | 'error';

export type { SharedSessionParticipant };

const DATA_CHANNEL_LABEL = 'streetview-sync';
/** STUN + optional TURN — see docs/SHARED_SESSIONS.md. */
const ICE_SERVERS: RTCIceServer[] = resolveIceServers();
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Guests apply state in sequence order only, so a message that arrives late
 * (out-of-order data channel delivery, retried send) never rolls the view
 * backwards. `seq` is never reset except by starting a brand-new hosted
 * room, so a guest reconnecting mid-session simply resumes from whatever
 * seq the host is currently on — no special-casing needed to avoid
 * corruption on disconnect/reconnect.
 */
export function shouldApplyIncomingState(
  current: SessionState | null,
  incoming: SessionState
): boolean {
  if (!current) return true;
  return incoming.seq > current.seq;
}

interface PeerConnectionEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  remoteDescriptionSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface UseSharedSessionResult {
  role: SharedSessionRole;
  status: SharedSessionStatus;
  error: string | null;
  /** Short room code guests use to join (set by the host on create, or the guest on join). */
  roomCode: string | null;
  /** Live roster of everyone in the room (self included), from Realtime presence. */
  participants: SharedSessionParticipant[];
  /** Latest state received by a guest from the host. */
  latestState: SessionState | null;
  /** Host: true once at least one guest's data channel is open. Guest: true once connected to the host. */
  isConnected: boolean;
  /** Host: create a new room and generate a room code for guests to join. */
  createRoom: () => Promise<void>;
  /** Guest: join a room by its code. */
  joinRoom: (code: string) => Promise<void>;
  /** Host: broadcast the current view to all connected guests. */
  broadcastState: (state: Omit<SessionState, 'seq'>) => void;
  leaveSession: () => void;
}

export function useSharedSession(): UseSharedSessionResult {
  const [role, setRole] = useState<SharedSessionRole>(null);
  const [status, setStatus] = useState<SharedSessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [participants, setParticipants] = useState<SharedSessionParticipant[]>([]);
  const [latestState, setLatestState] = useState<SessionState | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const clientIdRef = useRef<string | null>(null);
  if (clientIdRef.current === null) clientIdRef.current = generateClientId();

  const signalingRef = useRef<RoomSignalingClient | null>(null);
  /** Host: guestClientId -> connection. Guest: hostClientId -> connection (single entry). */
  const peersRef = useRef<Map<string, PeerConnectionEntry>>(new Map());
  const hostClientIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const roleRef = useRef<SharedSessionRole>(null);
  roleRef.current = role;

  const clearReconnectTimer = useCallback((peerId: string) => {
    const timer = reconnectTimersRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      reconnectTimersRef.current.delete(peerId);
    }
  }, []);

  const closePeer = useCallback((peerId: string) => {
    clearReconnectTimer(peerId);
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    entry.dc?.close();
    entry.pc.close();
    peersRef.current.delete(peerId);
  }, [clearReconnectTimer]);

  const teardown = useCallback(() => {
    for (const timer of reconnectTimersRef.current.values()) clearTimeout(timer);
    reconnectTimersRef.current.clear();
    reconnectAttemptsRef.current.clear();
    for (const peerId of Array.from(peersRef.current.keys())) closePeer(peerId);
    peersRef.current.clear();
    hostClientIdRef.current = null;
    void signalingRef.current?.leave();
    signalingRef.current = null;
  }, [closePeer]);

  /** Recompute isConnected/status from live peer data-channel state. */
  const syncConnectionStatus = useCallback(() => {
    let anyOpen = false;
    for (const entry of peersRef.current.values()) {
      if (entry.dc?.readyState === 'open') {
        anyOpen = true;
        break;
      }
    }
    setIsConnected(anyOpen);
    setStatus((prev) => {
      if (anyOpen) return 'connected';
      if (prev === 'connected') return 'disconnected';
      return prev;
    });
  }, []);

  const flushPendingCandidates = useCallback(async (entry: PeerConnectionEntry) => {
    entry.remoteDescriptionSet = true;
    const pending = entry.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('[SharedSession] Failed to add queued ICE candidate', e);
      }
    }
  }, []);

  /** Host: open a fresh RTCPeerConnection + data channel for one guest and send it an offer. */
  const connectToGuest = useCallback(
    async (guestClientId: string) => {
      clearReconnectTimer(guestClientId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry: PeerConnectionEntry = { pc, dc: null, remoteDescriptionSet: false, pendingCandidates: [] };
      peersRef.current.set(guestClientId, entry);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingRef.current?.send({ type: 'ice-candidate', to: guestClientId, payload: e.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        syncConnectionStatus();
        const attempts = reconnectAttemptsRef.current.get(guestClientId) ?? 0;
        const stillPresent = peersRef.current.has(guestClientId);
        if (shouldRetryPeerConnection(pc.connectionState, stillPresent, attempts, MAX_RECONNECT_ATTEMPTS)) {
          closePeer(guestClientId);
          reconnectAttemptsRef.current.set(guestClientId, attempts + 1);
          const timer = setTimeout(() => {
            if (roleRef.current === 'host') void connectToGuest(guestClientId);
          }, RECONNECT_DELAY_MS);
          reconnectTimersRef.current.set(guestClientId, timer);
        } else if (pc.connectionState === 'failed' && attempts >= MAX_RECONNECT_ATTEMPTS) {
          setError(
            'Could not keep a peer-to-peer connection with one guest — this usually means a strict NAT/firewall ' +
              'without a TURN server. See README "Shared Exploration Sessions" for TURN setup.',
          );
        }
      };

      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
      entry.dc = dc;
      dc.onopen = () => {
        reconnectAttemptsRef.current.delete(guestClientId);
        syncConnectionStatus();
      };
      dc.onclose = () => syncConnectionStatus();

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signalingRef.current?.send({ type: 'offer', to: guestClientId, payload: offer });
      } catch (e) {
        console.warn('[SharedSession] Failed to create offer for guest', guestClientId, e);
        closePeer(guestClientId);
      }
    },
    [clearReconnectTimer, closePeer, syncConnectionStatus],
  );

  /** Guest: respond to the host's offer with a fresh RTCPeerConnection + answer. */
  const connectToHost = useCallback(
    async (hostId: string, offer: RTCSessionDescriptionInit) => {
      closePeer(hostId); // tear down any previous attempt before renegotiating
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry: PeerConnectionEntry = { pc, dc: null, remoteDescriptionSet: false, pendingCandidates: [] };
      peersRef.current.set(hostId, entry);
      hostClientIdRef.current = hostId;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingRef.current?.send({ type: 'ice-candidate', to: hostId, payload: e.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        syncConnectionStatus();
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus((prev) => (prev === 'host-left' ? prev : 'disconnected'));
        }
      };
      pc.ondatachannel = (e) => {
        entry.dc = e.channel;
        e.channel.onopen = () => syncConnectionStatus();
        e.channel.onclose = () => syncConnectionStatus();
        e.channel.onmessage = (event) => {
          try {
            const incoming = JSON.parse(event.data) as SessionState;
            setLatestState((current) => (shouldApplyIncomingState(current, incoming) ? incoming : current));
          } catch {
            // Ignore malformed messages rather than crashing the session.
          }
        };
      };

      try {
        await pc.setRemoteDescription(offer);
        await flushPendingCandidates(entry);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalingRef.current?.send({ type: 'answer', to: hostId, payload: answer });
        setStatus('connecting');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to answer host offer');
        setStatus('error');
      }
    },
    [closePeer, flushPendingCandidates, syncConnectionStatus],
  );

  const handleSignalingMessage = useCallback(
    (message: SignalingMessage) => {
      const entry = peersRef.current.get(message.from);

      if (message.type === 'offer') {
        // Only guests receive offers, always from the host.
        void connectToHost(message.from, message.payload as RTCSessionDescriptionInit);
        return;
      }

      if (message.type === 'answer') {
        if (!entry) return;
        entry.pc
          .setRemoteDescription(message.payload as RTCSessionDescriptionInit)
          .then(() => flushPendingCandidates(entry))
          .catch((e) => console.warn('[SharedSession] Failed to apply guest answer', e));
        return;
      }

      if (message.type === 'ice-candidate') {
        if (!entry) return;
        const candidate = message.payload as RTCIceCandidateInit;
        if (entry.remoteDescriptionSet) {
          entry.pc.addIceCandidate(candidate).catch((e) => console.warn('[SharedSession] Failed to add ICE candidate', e));
        } else {
          entry.pendingCandidates.push(candidate);
        }
      }
    },
    [connectToHost, flushPendingCandidates],
  );

  const createRoom = useCallback(async () => {
    teardown();
    setError(null);
    setLatestState(null);
    setParticipants([]);
    seqRef.current = 0;
    setRole('host');
    setStatus('creating-room');

    const realtime = getSignalingRealtimeClient();
    if (!realtime) {
      setError('Shared sessions need a signaling connection that is not configured in this deployment.');
      setStatus('error');
      setRole(null);
      return;
    }

    try {
      const code = generateRoomCode();
      const self: PresenceEntry = { clientId: clientIdRef.current!, role: 'host' };
      const signaling = createRoomSignalingClient(realtime, code, self);
      signalingRef.current = signaling;

      signaling.onMessage(handleSignalingMessage);
      signaling.onPresenceSync((entries) => setParticipants(toSharedSessionParticipants(entries, self.clientId)));
      signaling.onPresenceJoin((entries) => {
        for (const entry of entries) {
          if (entry.role === 'guest' && entry.clientId !== self.clientId) void connectToGuest(entry.clientId);
        }
      });
      signaling.onPresenceLeave((entries) => {
        for (const entry of entries) closePeer(entry.clientId);
      });

      setRoomCode(code);
      setStatus('awaiting-guests');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session room');
      setStatus('error');
    }
  }, [teardown, handleSignalingMessage, connectToGuest, closePeer]);

  const joinRoom = useCallback(
    async (codeInput: string) => {
      if (!isValidRoomCode(codeInput)) {
        setError("That room code doesn't look right — codes are 6 characters.");
        setStatus('error');
        return;
      }

      teardown();
      setError(null);
      setLatestState(null);
      setParticipants([]);
      setRole('guest');
      setStatus('joining-room');

      const realtime = getSignalingRealtimeClient();
      if (!realtime) {
        setError('Shared sessions need a signaling connection that is not configured in this deployment.');
        setStatus('error');
        setRole(null);
        return;
      }

      try {
        const code = normalizeRoomCode(codeInput);
        const self: PresenceEntry = { clientId: clientIdRef.current!, role: 'guest' };
        const signaling = createRoomSignalingClient(realtime, code, self);
        signalingRef.current = signaling;

        signaling.onMessage(handleSignalingMessage);
        signaling.onPresenceSync((entries) => setParticipants(toSharedSessionParticipants(entries, self.clientId)));
        signaling.onPresenceLeave((entries) => {
          for (const entry of entries) {
            if (entry.clientId === hostClientIdRef.current) {
              closePeer(entry.clientId);
              setStatus('host-left');
              setIsConnected(false);
            }
          }
        });

        setRoomCode(code);
        setStatus('connecting');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to join session room');
        setStatus('error');
      }
    },
    [teardown, handleSignalingMessage, closePeer],
  );

  const broadcastState = useCallback((state: Omit<SessionState, 'seq'>) => {
    seqRef.current += 1;
    const message = JSON.stringify({ ...state, seq: seqRef.current });
    for (const entry of peersRef.current.values()) {
      if (entry.dc?.readyState === 'open') entry.dc.send(message);
    }
  }, []);

  const leaveSession = useCallback(() => {
    teardown();
    setRole(null);
    setStatus('idle');
    setError(null);
    setRoomCode(null);
    setParticipants([]);
    setLatestState(null);
    setIsConnected(false);
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    role,
    status,
    error,
    roomCode,
    participants,
    latestState,
    isConnected,
    createRoom,
    joinRoom,
    broadcastState,
    leaveSession,
  };
}
