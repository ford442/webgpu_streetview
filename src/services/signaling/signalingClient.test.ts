import {
  createRoomSignalingClient,
  generateClientId,
  generateRoomCode,
  isValidRoomCode,
  roomChannelName,
  type PresenceEntry,
  type RealtimeChannelLike,
  type SignalingMessage,
  type SupabaseRealtimeClientLike,
} from './signalingClient';

/**
 * In-memory fake standing in for a Supabase Realtime client/channel pair —
 * this is our "mock WS": no real socket, but the same broadcast + presence
 * semantics `createRoomSignalingClient` depends on (self:false broadcast,
 * presence sync/join/leave scoped per channel name).
 */
class FakeRoom {
  private channels = new Set<FakeChannel>();
  private presence = new Map<FakeChannel, Record<string, unknown>>();

  register(channel: FakeChannel) {
    this.channels.add(channel);
  }

  unregister(channel: FakeChannel) {
    this.channels.delete(channel);
    this.presence.delete(channel);
  }

  broadcast(sender: FakeChannel, event: string, payload: unknown) {
    for (const channel of this.channels) {
      if (channel === sender) continue; // broadcast: { self: false }
      channel.deliverBroadcast(event, payload);
    }
  }

  track(channel: FakeChannel, state: Record<string, unknown>) {
    this.presence.set(channel, state);
    for (const c of this.channels) c.deliverPresenceSync();
    for (const c of this.channels) c.deliverPresenceJoin([state]);
  }

  untrack(channel: FakeChannel) {
    const state = this.presence.get(channel);
    this.presence.delete(channel);
    for (const c of this.channels) c.deliverPresenceSync();
    if (state) for (const c of this.channels) c.deliverPresenceLeave([state]);
  }

  presenceState(): Record<string, Array<Record<string, unknown>>> {
    const result: Record<string, Array<Record<string, unknown>>> = {};
    for (const state of this.presence.values()) {
      const key = String(state.clientId ?? 'unknown');
      result[key] = [state];
    }
    return result;
  }
}

class FakeChannel implements RealtimeChannelLike {
  private broadcastHandlers = new Map<string, Array<(message: { payload: unknown }) => void>>();
  private syncHandlers: Array<() => void> = [];
  private joinHandlers: Array<(p: { key: string; newPresences?: unknown[] }) => void> = [];
  private leaveHandlers: Array<(p: { key: string; leftPresences?: unknown[] }) => void> = [];

  constructor(private room: FakeRoom) {}

  on(type: 'broadcast' | 'presence', filter: { event: string }, callback: (...args: any[]) => void): this {
    if (type === 'broadcast') {
      const arr = this.broadcastHandlers.get(filter.event) ?? [];
      arr.push(callback);
      this.broadcastHandlers.set(filter.event, arr);
    } else if (filter.event === 'sync') {
      this.syncHandlers.push(callback);
    } else if (filter.event === 'join') {
      this.joinHandlers.push(callback);
    } else if (filter.event === 'leave') {
      this.leaveHandlers.push(callback);
    }
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    this.room.register(this);
    callback?.('SUBSCRIBED');
    return this;
  }

  send(message: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown> {
    this.room.broadcast(this, message.event, message.payload);
    return Promise.resolve();
  }

  track(state: Record<string, unknown>): Promise<unknown> {
    this.room.track(this, state);
    return Promise.resolve();
  }

  untrack(): Promise<unknown> {
    this.room.untrack(this);
    return Promise.resolve();
  }

  presenceState(): Record<string, Array<Record<string, unknown>>> {
    return this.room.presenceState();
  }

  deliverBroadcast(event: string, payload: unknown) {
    (this.broadcastHandlers.get(event) ?? []).forEach((h) => h({ payload }));
  }

  deliverPresenceSync() {
    this.syncHandlers.forEach((h) => h());
  }

  deliverPresenceJoin(newPresences: unknown[]) {
    this.joinHandlers.forEach((h) => h({ key: '', newPresences }));
  }

  deliverPresenceLeave(leftPresences: unknown[]) {
    this.leaveHandlers.forEach((h) => h({ key: '', leftPresences }));
  }
}

class FakeSupabaseRealtimeClient implements SupabaseRealtimeClientLike {
  private rooms = new Map<string, FakeRoom>();

  channel(name: string): RealtimeChannelLike {
    let room = this.rooms.get(name);
    if (!room) {
      room = new FakeRoom();
      this.rooms.set(name, room);
    }
    return new FakeChannel(room);
  }

  removeChannel(channel: RealtimeChannelLike): Promise<unknown> {
    for (const room of this.rooms.values()) room.unregister(channel as FakeChannel);
    return Promise.resolve();
  }
}

describe('room code helpers', () => {
  it('generateRoomCode produces a 6-char code from the safe alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('generateRoomCode does not use ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRoomCode()).not.toMatch(/[0O1IL]/);
    }
  });

  it('isValidRoomCode accepts well-formed codes case/whitespace-insensitively', () => {
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('abcdef')).toBe(true);
    expect(isValidRoomCode('  ABCDEF  ')).toBe(true);
  });

  it('isValidRoomCode rejects malformed codes', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('AB')).toBe(false);
    expect(isValidRoomCode('ABCDEFGHIJK')).toBe(false);
    expect(isValidRoomCode('ABC-DEF')).toBe(false);
    expect(isValidRoomCode('ABCDE0')).toBe(false); // '0' excluded from the alphabet
  });

  it('roomChannelName is a stable, normalized channel name', () => {
    expect(roomChannelName('abcdef')).toBe('streetview-room:ABCDEF');
    expect(roomChannelName('  ABCDEF  ')).toBe('streetview-room:ABCDEF');
  });

  it('generateClientId produces distinct ids', () => {
    const a = generateClientId();
    const b = generateClientId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

/** `send()` is queued behind the channel's async subscribe/track handshake. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createRoomSignalingClient', () => {
  const host: PresenceEntry = { clientId: 'host-1', role: 'host' };
  const guest: PresenceEntry = { clientId: 'guest-1', role: 'guest' };

  it('delivers a message only to its addressed recipient', async () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);
    const guestSignaling = createRoomSignalingClient(client, 'ROOM01', guest);

    const received: SignalingMessage[] = [];
    guestSignaling.onMessage((m) => received.push(m));
    const hostReceived: SignalingMessage[] = [];
    hostSignaling.onMessage((m) => hostReceived.push(m));

    hostSignaling.send({ type: 'offer', to: guest.clientId, payload: { sdp: 'v=0' } });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'offer', from: host.clientId, to: guest.clientId, payload: { sdp: 'v=0' } });
    expect(hostReceived).toHaveLength(0);
  });

  it('ignores messages addressed to a different client', async () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);
    const guestSignaling = createRoomSignalingClient(client, 'ROOM01', guest);
    createRoomSignalingClient(client, 'ROOM01', { clientId: 'guest-2', role: 'guest' });

    const received: SignalingMessage[] = [];
    guestSignaling.onMessage((m) => received.push(m));

    hostSignaling.send({ type: 'answer', to: 'guest-2', payload: {} });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('keeps rooms with different codes isolated', async () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);
    const otherRoomGuest = createRoomSignalingClient(client, 'ROOM02', guest);

    const received: SignalingMessage[] = [];
    otherRoomGuest.onMessage((m) => received.push(m));

    hostSignaling.send({ type: 'offer', to: guest.clientId, payload: {} });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('reports the full roster via onPresenceSync as participants join', () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);

    const rosters: PresenceEntry[][] = [];
    hostSignaling.onPresenceSync((participants) => rosters.push(participants));

    createRoomSignalingClient(client, 'ROOM01', guest);

    const last = rosters[rosters.length - 1]!;
    expect(last).toHaveLength(2);
    expect(last.map((p) => p.clientId).sort()).toEqual(['guest-1', 'host-1']);
  });

  it('fires onPresenceJoin with just the new participant', () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);

    const joined: PresenceEntry[] = [];
    hostSignaling.onPresenceJoin((participants) => joined.push(...participants));

    createRoomSignalingClient(client, 'ROOM01', guest);

    expect(joined).toHaveLength(1);
    expect(joined[0]).toEqual(guest);
  });

  it('fires onPresenceLeave for the other side when a participant leaves', async () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);
    const guestSignaling = createRoomSignalingClient(client, 'ROOM01', guest);

    const left: PresenceEntry[] = [];
    hostSignaling.onPresenceLeave((participants) => left.push(...participants));

    await guestSignaling.leave();

    expect(left).toHaveLength(1);
    expect(left[0]).toEqual(guest);
  });

  it('unsubscribe functions stop further delivery', async () => {
    const client = new FakeSupabaseRealtimeClient();
    const hostSignaling = createRoomSignalingClient(client, 'ROOM01', host);
    const guestSignaling = createRoomSignalingClient(client, 'ROOM01', guest);

    const received: SignalingMessage[] = [];
    const unsubscribe = guestSignaling.onMessage((m) => received.push(m));

    hostSignaling.send({ type: 'ice-candidate', to: guest.clientId, payload: { n: 1 } });
    await flush();
    expect(received).toHaveLength(1);

    unsubscribe();
    hostSignaling.send({ type: 'ice-candidate', to: guest.clientId, payload: { n: 2 } });
    await flush();

    expect(received).toHaveLength(1);
  });
});
