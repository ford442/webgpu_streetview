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
- **Film-set v2**: the same 10 Hz payload may include `lookId`, `imageDate` (`YYYY-MM`), `vehicleType` (VehicleManager SSOT), `cabinView` (`driver` | `chauffeur`), `carHeading`, and informational `hdr`. Unknown look/vehicle/cabin values are dropped — guests never white-screen. Year change is the host `panoId` teleport through hold-pause (`armHold()`); guests do not crawl historical imagery or scrape a second Maps canvas. `hdr` is not a guest display command.

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

Guests **lock to the host film set**: panorama (via hold-pause teleport), named look, vehicle, view mode (freelook/car), and car-body yaw. After the first packet seeds heading/pitch, **head look stays local** so guests can look around the cabin and street. Host zoom remains applied. This replaces the earlier hard-follow of heading/pitch every tick.

Keyed Playwright covering a live guest join is a follow-up; unit tests cover seq ordering and unknown-field drops. Manual/keyed bar: `window.__STREETVIEW_PROBE__.getWarnings()` empty after hops.

## Cinema capture

Cinema WebM records the **Street View renderer canvas** (graded road / weather). The Three.js cabin is a separate overlay today, so clips are **road-only** until the single-GPUDevice cabin work composites glass + road into one swapchain. A JSON sidecar (`panoIds`, `imageDates`, `lookId`, `vehicleType`) downloads with the clip. Stills use the same canvas plus JPEG EXIF (GPS + UserComment). Nobody in this path calls the Street View Static API.

## Billing / imagery

- Shared sessions **never** fetch Street View Static API imagery.
- Signaling carries handshake metadata only — no Google tiles are cached by the session layer (`swPolicy` remains `network-only` for `maps.googleapis.com`).
- Rearview Static feed stays opt-in, throttled, default off — this feature does not turn it on.

## Related files

| File | Role |
|------|------|
| `src/hooks/useSharedSession.ts` | WebRTC + room lifecycle |
| `src/app/useSharedSessionSync.ts` | 10 Hz host broadcast + guest apply |
| `src/app/sharedSessionSync.ts` | Pure payload builders |
| `src/utils/iceServers.ts` | STUN + optional TURN resolution |
| `src/utils/weatherPresetSync.ts` | Weather preset serialize/parse |
| `src/utils/studioLink.ts` | Share URLs: `?look=&year=&vehicle=` plus location |
| `src/utils/cinemaSidecar.ts` | WebM metadata JSON (road-only capture) |
| `src/utils/exifGps.ts` | JPEG GPS + UserComment film-set fields |

## Audio

Wind/rain bed stays in the Web Audio graph. v1 spatialization is `StereoPannerNode` from head-vs-car yaw. **HRTF convolution is out of scope** until a follow-up wasm export after emcc (no new WAT).
