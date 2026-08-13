# Shared Exploration Sessions

Multiplayer Street View road trips: a **host** drives (cruise, keyboard, MiniMap); **guests** follow the host POV over a WebRTC data channel. Signaling uses Supabase Realtime room codes — no imagery or POV state is persisted server-side.

## Architecture

```
Host browser                         Guest browser
┌─────────────────┐               ┌─────────────────┐
│ Street View     │               │ Street View     │
│ useSharedSession│◄──WebRTC DC──►│ useSharedSession│
│ (broadcast POV) │   (P2P only)  │ (apply POV)     │
└────────┬────────┘               └────────┬────────┘
         │ SDP + ICE candidates             │
         └──────────► Supabase Realtime ◄───┘
                    (signaling only)
```

- **Media path**: peer-to-peer `RTCDataChannel` (`streetview-sync` label), hub topology (host ↔ each guest).
- **Signaling**: 6-character room codes via Supabase Realtime — SDP offers/answers and trickle ICE only.
- **Weather sync**: host broadcasts a compact `weatherPreset` string (`tod:night|rain:0.50|…`) at 10 Hz with POV; guests apply time-of-day and weather sliders when it changes.

## STUN vs TURN

| | STUN | TURN |
|---|------|------|
| **Purpose** | Discover public IP / NAT type | Relay traffic when direct P2P fails |
| **Default** | `stun:stun.l.google.com:19302` (always on) | Off unless configured |
| **Cost** | Free public STUN | You operate or rent a TURN server |
| **When needed** | Most home NATs | Symmetric NAT, corporate firewalls on **both** ends |

The app resolves ICE servers in `src/utils/iceServers.ts`:

1. Google STUN (always).
2. Optional TURN when `REACT_APP_TURN_URL` (or `VITE_TURN_URL`) is set at build time, **or** `window.TURN_URL` (+ optional `TURN_USERNAME` / `TURN_CREDENTIAL`) in runtime `public/config.js`.

**No code fork is required** — only configuration. Never commit TURN credentials to git; use deploy secrets or post-deploy `config.js` edits.

### Example runtime config

```js
// public/config.js (after deploy)
window.TURN_URL = "turn:turn.example.com:3478";
window.TURN_USERNAME = "user";
window.TURN_CREDENTIAL = "secret";
```

### Example build-time env (`.env.local`)

```
REACT_APP_TURN_URL=turn:turn.example.com:3478
REACT_APP_TURN_USERNAME=user
REACT_APP_TURN_CREDENTIAL=secret
```

## Reconnect / host-migrate

- Guests apply incoming state only when `seq` increases (`shouldApplyIncomingState`) — late packets never roll the view backward.
- On disconnect, the client retries up to 5 times with a 2 s delay (`MAX_RECONNECT_ATTEMPTS`, `RECONNECT_DELAY_MS` in `useSharedSession.ts`).
- **Host-migrate** is not automated: if the host leaves, guests see `host-left`. A guest must create a new room to become host.

## Guest follow modes

Current behavior: **hard follow** — guests teleport to the host pano and mirror heading/pitch/zoom. Free-look offset for guests is a future UX option; the data model already carries full POV for extension.

## Billing / imagery

- Shared sessions **never** fetch Street View Static API imagery.
- Signaling carries handshake metadata only — no Google tiles are cached by the session layer (`swPolicy` remains `network-only` for `maps.googleapis.com`).

## Related files

| File | Role |
|------|------|
| `src/hooks/useSharedSession.ts` | WebRTC + room lifecycle |
| `src/app/useSharedSessionSync.ts` | 10 Hz host broadcast + guest apply |
| `src/app/sharedSessionSync.ts` | Pure payload builders |
| `src/utils/iceServers.ts` | STUN + optional TURN resolution |
| `src/utils/weatherPresetSync.ts` | Weather preset serialize/parse |
