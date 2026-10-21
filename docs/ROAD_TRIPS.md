# Road trips you own

A routed road trip (#303 / #316) drives A → B along an OSRM route. #332 makes
the trip a thing you keep: save its Street View link graph for offline, drive
it with a real shortest path when the network is gone, record every hop, and
replay or share the recording.

**The ToS line:** the app stores metadata and its own state only — pano ids,
coordinates, link ids and headings, capture dates, your view and your
settings. It never stores Google imagery, tiles or canvases (`swPolicy.ts`
keeps Google hosts `network-only`). A replay asks Google for every pano again,
by id, on the viewer's own quota.

| Piece | Code | Maps calls |
|---|---|---|
| Graph kernel | `cpp/src/graph_module.cpp`, `src/wasm/graph.ts` | none |
| Save for offline | `src/offline/tripPrefetch.ts` | ≈ 1 per 10 m of route (one per pano walked), metered `trip-prefetch`, confirmed first |
| Offline drive | `services/routing/tripController.ts` (`planGraphHop`), `offline/routeGraphNavigation.ts` | none to plan; the hop is `setPano` |
| Recorder | `src/trip/tripRecorder.ts` | none |
| Replay | `src/trip/tripReplay.ts`, `src/trip/tripReplayController.ts` | 1 per replayed hop, metered `replay` |
| Files / links | `src/trip/tripFile.ts` | none (a `?trip=` link plans its route: one OSRM request) |

## 1. The link graph and its kernel

A saved trip is a set of `RouteGraphNode`s (`offline/offlineStore.ts`, store
`routeGraph`, keyed `routeId:panoId`): `{ panoId, lat, lng, linkPanoIds,
linkHeadings?, imageDate? }`. Links are **directed** — a link the Maps API
reports only one way is one edge.

`wasm/graph.ts` flattens the nodes into CSR once per route (`linkGraphFor`,
cached by `routeId`): nodes in pano-id sort order (the same graph always yields
the same CSR, whatever order IndexedDB returned it in), `offsets` (n + 1),
`neighbors` (links to panos outside the graph are dropped) and `coords`.

`graph_astar` is A* with the haversine of `geodesy_module.cpp` as both the
edge cost and the heuristic (admissible on a sphere, so the path is the
shortest one). The open set is a binary heap with decrease-key, held in the
caller's arena (`n × 32` bytes, `SW_GRAPH_ASTAR_WORK_BYTES_PER_NODE`); nothing
allocates or throws. Ties break on the lower node index everywhere, so a path
is a pure function of the CSR arrays and the scalar binary, the SIMD binary and
the JS twin (`jsFallback.ts`) return the same node list. `graph_nearest` is
the nearest node, ties to the lower index. Goldens: a 200-node synthetic
Lisbon grid with missing links, one-way streets and a node with no way in
(`scripts/gen-wasm-goldens.mjs`, `cpp/tests/graph_module_test.cpp`, which also
checks every golden path against an O(n²) Dijkstra).

`planOfflineHop(graph, currentPanoId, destination)` returns the next pano on
the shortest path to the graph pano nearest the destination. When the graph
has no path (a gap the prefetch could not cross) it falls back to the old
greedy bearing walk and says so (`kind: 'greedy'`) — the greedy walk can
dead-end in a one-way loop, which is exactly what the kernel exists to avoid
(`routeGraphNavigation.test.ts`).

## 2. Save for offline

The Trip panel shows the cost before anything is fetched — `≈N panorama
lookups (at most M)` where N is the route's 10 m resample count and M is
1.25 × N — and starts only on **Start**. Then:

1. Snap the route start to a pano (`getPanorama({ location })`).
2. At each pano, pick the link whose heading tracks the route 12 m ahead (the
   same choice `RouteFollower.planHop` makes) and fetch it by id. The walk
   follows real links, so consecutive saved panos are linked in the graph
   (snapping a grid of points to their nearest pano leaves gaps).
3. No link toward the route, or the next pano is > 40 m off it: re-enter the
   route by location 20 m further on.
4. Stop at the destination, at M lookups (`cap`), when the session meter
   refuses (`budget`), or on Cancel. What was gathered is saved either way, and
   the panel says how much of the route it covers.

Every lookup is `tryConsume('panorama', 'trip-prefetch')` first.

## 3. Offline drive

`isTripOffline()` (`app/useTripBindings.ts`) is `?offline=1` or
`navigator.onLine === false`. While it holds and the cached graph for the
active route contains the current pano, the trip controller's guide plans
each cruise hop with `planOfflineHop` and returns its heading (the live link
to that pano, else the stored link heading, else the bearing). Cruise still
hops with `advanceSafe` → `setPano`: Maps serves the imagery from its own cache
or fails honestly. Off the graph the live follower decides. The counts are on
`tripStore.offlineDrive` (`astarHops`, `greedyHops`, `offGraphHops`) and in
the Trip panel; a greedy hop is also logged.

Online, the graph is never consulted, and an on-route hop still makes zero
Maps calls (`useCruiseMode.route.test.tsx`).

## 4. Recorder

`createTripRecorder` subscribes to `tripStore`: `driving` starts a recording
(resuming the same route continues it), every progress update samples the
current pano and appends a hop when the pano changed, `arrived` / clearing
finishes it. A hop is `{ t, panoId, panoDate, lat, lng, heading, pitch, zoom,
carHeading, weather, look, nightIntensity }`; `weather` is what the user set
(rain, snow, wind, fog, time of day), not live conditions. `panoDate` comes
from the saved graph or the historical time machine when known, and a replay
fills in the rest. Snapshots taken during the drive are listed as the trip's
album stills (the image stays in the gallery). Capped at 5000 hops
(`truncated`); stored in IndexedDB `tripRecordings` (DB v2).

## 5. Replay

`TripReplay` walks the hops: `tryConsume('panorama', 'replay')`, look the pano
up by id, `teleportToPanoSafe` (hold-pause path), then restore the view
(`setHeading` / `setPitch` / `setZoom` / `setCarHeading`) and the settings.
The gap between hops is the recorded one, clamped to 1.5–8 s so each pano can
load. Pause, resume and scrub are in the Trip panel; replay switches cruise
off.

A pano id pins one capture, so the same id is the same imagery date. The
lookup's `imageDate` is compared with the recording (`dateMismatches`) and
written back where the recording did not know it. A pano that no longer
resolves is replaced by the recorded year's capture nearby
(`getHistoricalImagery` + `pickHistoricalEntryForYear`, its own metered crawl)
when the hop has a date, otherwise skipped; both are counted and shown. When
the meter refuses, replay stops and says so.

Probe: `window.__STREETVIEW_PROBE__.getTripRecordings()`.

## 6. Files, links, sessions

- **`.svtrip`** — the versioned recording JSON (`TRIP_FORMAT_VERSION = 1`)
  gzipped with `CompressionStream`. Import accepts it or plain JSON;
  `parseTripRecording` rejects the whole file if any hop is malformed.
- **`?trip=`** — a compact form (hop deltas, rounded view, the environment
  only where it changes), gzip + base64url, offered only under 2048 chars
  (roughly 50–60 hops); longer trips are shared as a file. Opening one saves the
  recording, plans its route and opens the Trip panel — replaying it is the
  viewer's choice, on their quota.
- **Shared sessions** — the host broadcasts `SessionState.replay = { link,
  index, playing }` while replaying a link-sized recording. A guest decodes it,
  replays locally (own lookups), re-seeks when it drifts two hops from the
  host, and ignores the host's pano packets while it does.

## 7. Tests

| What | Where |
|---|---|
| Kernel goldens, Dijkstra check, one-way loop, invalid input | `cpp/tests/graph_module_test.cpp` (`npm run test:cpp`) |
| ABI lock, JS twin parity, 5000-node arena regrow | `src/wasm/__tests__/` |
| Greedy dead-end vs A* | `src/offline/routeGraphNavigation.test.ts` |
| Prefetch walk, gap re-snap, cap, abort | `src/offline/tripPrefetch.test.ts` |
| Offline cruise reaches the destination with zero calls | `src/hooks/__tests__/useCruiseMode.route.test.tsx` |
| Recorder, replay (metering, cap, substitution, seek), files, links | `src/trip/trip.test.ts` |
| Host broadcast → guest local replay | `src/trip/tripReplayController.test.ts` |
| Recorded trip replays to the same pano ids and dates (`@keyed`) | `e2e/trip-replay.spec.ts` |
