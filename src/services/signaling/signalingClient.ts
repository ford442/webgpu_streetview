/**
 * Room-code signaling for Shared Exploration Sessions.
 *
 * Replaces manual SDP offer/answer copy-paste with a short room code backed
 * by a Supabase Realtime channel: participants broadcast SDP/ICE messages
 * to each other and see a live presence roster, all scoped to one channel
 * per room. Only signaling metadata (SDP, ICE candidates, client/role ids)
 * ever passes through this channel — never Street View imagery, and never
 * the actual synced POV state (that still flows peer-to-peer over the
 * WebRTC data channel once connected, see useSharedSession.ts).
 *
 * Kept decoupled from the real `@supabase/supabase-js` types via a small
 * duck-typed interface (see `RealtimeChannelLike` / `SupabaseRealtimeClientLike`)
 * so this module — and the WebRTC signaling logic that depends on it — stays
 * unit-testable with a plain in-memory fake instead of a real socket.
 */

export type SignalingRole = 'host' | 'guest';

export type SignalingMessageType = 'offer' | 'answer' | 'ice-candidate';

export interface SignalingMessage {
  type: SignalingMessageType;
  /** Sender's clientId, stamped by the signaling client — callers never set this. */
  from: string;
  /** Recipient's clientId. */
  to: string;
  payload: unknown;
}

export interface PresenceEntry {
  clientId: string;
  role: SignalingRole;
}

/** Minimal shape of a Supabase Realtime channel this module depends on. */
export interface RealtimeChannelLike {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: { payload: unknown }) => void,
  ): RealtimeChannelLike;
  on(
    type: 'presence',
    filter: { event: 'sync' },
    callback: () => void,
  ): RealtimeChannelLike;
  on(
    type: 'presence',
    filter: { event: 'join' | 'leave' },
    callback: (payload: { key: string; newPresences?: unknown[]; leftPresences?: unknown[] }) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string, err?: Error) => void): RealtimeChannelLike;
  send(message: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
  track(state: Record<string, unknown>): Promise<unknown>;
  untrack(): Promise<unknown>;
  presenceState(): Record<string, Array<Record<string, unknown>>>;
}

/** Minimal shape of the Supabase client this module depends on. */
export interface SupabaseRealtimeClientLike {
  channel(name: string, opts?: Record<string, unknown>): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown> | unknown;
}

const SIGNAL_EVENT = 'signal';
const ROOM_CHANNEL_PREFIX = 'streetview-room:';

/** Alphabet excludes 0/O/1/I/L to avoid ambiguous room codes when read aloud or handwritten. */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{4,8}$`);

/** Whether a user-entered string is shaped like a room code (case/whitespace-insensitive). */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code.trim().toUpperCase());
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function roomChannelName(roomCode: string): string {
  return `${ROOM_CHANNEL_PREFIX}${normalizeRoomCode(roomCode)}`;
}

export function generateClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RoomSignalingClient {
  clientId: string;
  /** Send a signaling message; `from` is stamped automatically. */
  send(message: Omit<SignalingMessage, 'from'>): void;
  /** Fires for every message addressed to this client. Returns an unsubscribe fn. */
  onMessage(handler: (message: SignalingMessage) => void): () => void;
  /** Fires with the full current roster whenever presence state syncs. */
  onPresenceSync(handler: (participants: PresenceEntry[]) => void): () => void;
  /** Fires with just the newly-joined participants. */
  onPresenceJoin(handler: (participants: PresenceEntry[]) => void): () => void;
  /** Fires with just the participants who left. */
  onPresenceLeave(handler: (participants: PresenceEntry[]) => void): () => void;
  /** Leave the room: untrack presence and tear down the channel. */
  leave(): Promise<void>;
}

function isPresenceEntry(value: unknown): value is PresenceEntry {
  const v = value as Partial<PresenceEntry> | null;
  return !!v && typeof v.clientId === 'string' && (v.role === 'host' || v.role === 'guest');
}

/**
 * Plain loop instead of `Array.prototype.filter(isPresenceEntry)`: TS's
 * type-guard filter overload requires the guard's target type to structurally
 * `extend` the array's element type, which an interface without an index
 * signature (PresenceEntry) never does against `Record<string, unknown>` —
 * so filter silently falls back to the non-narrowing overload instead.
 */
function toPresenceEntries(values: unknown[]): PresenceEntry[] {
  const result: PresenceEntry[] = [];
  for (const value of values) {
    if (isPresenceEntry(value)) result.push(value);
  }
  return result;
}

/** Join (or create) a room's signaling channel for one participant. */
export function createRoomSignalingClient(
  client: SupabaseRealtimeClientLike,
  roomCode: string,
  self: PresenceEntry,
): RoomSignalingClient {
  const channel = client.channel(roomChannelName(roomCode), {
    config: { broadcast: { self: false }, presence: { key: self.clientId } },
  });

  const messageHandlers = new Set<(message: SignalingMessage) => void>();
  const syncHandlers = new Set<(participants: PresenceEntry[]) => void>();
  const joinHandlers = new Set<(participants: PresenceEntry[]) => void>();
  const leaveHandlers = new Set<(participants: PresenceEntry[]) => void>();

  function currentParticipants(): PresenceEntry[] {
    const grouped: Array<Record<string, unknown>>[] = Object.values(channel.presenceState());
    return toPresenceEntries(grouped.flat());
  }

  channel.on('broadcast', { event: SIGNAL_EVENT }, ({ payload }) => {
    const message = payload as SignalingMessage;
    if (!message || message.to !== self.clientId) return;
    messageHandlers.forEach((handler) => handler(message));
  });

  channel.on('presence', { event: 'sync' }, () => {
    const participants = currentParticipants();
    syncHandlers.forEach((handler) => handler(participants));
  });

  channel.on('presence', { event: 'join' }, ({ newPresences }) => {
    const participants = toPresenceEntries(newPresences ?? []);
    if (participants.length > 0) joinHandlers.forEach((handler) => handler(participants));
  });

  channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    const participants = toPresenceEntries(leftPresences ?? []);
    if (participants.length > 0) leaveHandlers.forEach((handler) => handler(participants));
  });

  let subscribed = false;
  const ready = new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (subscribed) return;
        subscribed = true;
        void channel.track({ ...self }).then(() => resolve());
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!subscribed) reject(new Error(`Failed to join signaling room (${status})`));
      }
    });
  });
  // Signaling-room join failures surface through `send`'s rejection path in
  // callers that await it; avoid an unhandled-rejection warning for callers
  // that only use the fire-and-forget `send()`.
  ready.catch(() => {});

  return {
    clientId: self.clientId,
    send(message) {
      void ready.then(() =>
        channel.send({
          type: 'broadcast',
          event: SIGNAL_EVENT,
          payload: { ...message, from: self.clientId } satisfies SignalingMessage,
        }),
      );
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onPresenceSync(handler) {
      syncHandlers.add(handler);
      return () => syncHandlers.delete(handler);
    },
    onPresenceJoin(handler) {
      joinHandlers.add(handler);
      return () => joinHandlers.delete(handler);
    },
    onPresenceLeave(handler) {
      leaveHandlers.add(handler);
      return () => leaveHandlers.delete(handler);
    },
    async leave() {
      messageHandlers.clear();
      syncHandlers.clear();
      joinHandlers.clear();
      leaveHandlers.clear();
      try {
        await channel.untrack();
      } catch {
        // Best-effort — the channel is being torn down regardless.
      }
      await client.removeChannel(channel);
    },
  };
}
