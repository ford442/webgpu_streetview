import { MapsCallBudget } from '../services/maps/callBudget';
import { L_ROUTE, ORIGIN, buildGraph, linksOf, type FakePano } from '../services/routing/__tests__/routeFixtures';
import { buildActiveRoute } from '../services/routing/routeGeometry';
import { JS_FALLBACK } from '../wasm/jsFallback';
import { buildLinkGraph } from '../wasm/graph';
import type { RouteGraphNode } from './offlineStore';
import type { PanoLinkSnapshot } from './routePrefetch';
import { planOfflineHop } from './routeGraphNavigation';
import {
  TRIP_PREFETCH_SOURCE,
  estimateTripPrefetch,
  prefetchTripGraph,
  type TripPanoData,
  type TripStreetViewService,
} from './tripPrefetch';

const route = buildActiveRoute(L_ROUTE, { stops: [ORIGIN, L_ROUTE.polyline[4]!], providerId: 'test' });

function fakeService(graph: Map<string, FakePano>) {
  const requests: string[] = [];
  const data = (p: FakePano): TripPanoData => ({
    location: { pano: p.id, latLng: { lat: () => p.pos.lat, lng: () => p.pos.lng } },
    links: linksOf(graph, p.id),
    imageDate: '2024-06',
  });
  const service: TripStreetViewService = {
    getPanorama(request, callback) {
      if ('pano' in request) {
        requests.push(`pano:${request.pano}`);
        const p = graph.get(request.pano);
        callback(p ? data(p) : null, p ? 'OK' : 'ZERO_RESULTS');
        return;
      }
      requests.push('location');
      let best: FakePano | null = null;
      let bestD = request.radius ?? 50;
      for (const p of graph.values()) {
        const d = JS_FALLBACK.haversine(p.pos.lat, p.pos.lng, request.location.lat, request.location.lng);
        if (d <= bestD) {
          bestD = d;
          best = p;
        }
      }
      callback(best ? data(best) : null, best ? 'OK' : 'ZERO_RESULTS');
    },
  };
  return { service, requests };
}

const toNodes = (snaps: PanoLinkSnapshot[]): RouteGraphNode[] =>
  snaps.map((s) => ({ ...s, routeId: route.id, cachedAt: '2026-10-21T00:00:00.000Z' }));

describe('estimateTripPrefetch', () => {
  it('is one lookup per 10 m resample point, capped with head-room', () => {
    const e = estimateTripPrefetch(route);
    expect(e.calls).toBe(route.resampled.length / 2);
    expect(e.calls).toBeGreaterThanOrEqual(50);
    expect(e.calls).toBeLessThanOrEqual(52);
    expect(e.maxCalls).toBe(Math.ceil(e.calls * 1.25));
  });
});

describe('prefetchTripGraph', () => {
  it('walks the links along the route, meters every lookup and saves a connected graph', async () => {
    const { service, requests } = fakeService(buildGraph());
    const budget = new MapsCallBudget();
    let saved: PanoLinkSnapshot[] = [];
    const progress: number[] = [];
    const result = await prefetchTripGraph(route, service, {
      budget,
      save: async (_id, snaps) => { saved = snaps; },
      onProgress: (p) => progress.push(p.callsUsed),
    });

    expect(result.stop).toBe('complete');
    expect(result.callsUsed).toBe(requests.length);
    expect(budget.getStats().bySource[TRIP_PREFETCH_SOURCE]).toBe(requests.length);
    expect(result.callsUsed).toBeLessThanOrEqual(estimateTripPrefetch(route).calls);
    // One snap at the start, then link hops only — around the corner, not past it.
    expect(requests.filter((r) => r === 'location')).toHaveLength(1);
    const ids = saved.map((s) => s.panoId);
    expect(ids).toContain('m30');
    expect(ids).toContain('s18');
    expect(ids).not.toContain('m32');
    expect(saved.every((s) => s.imageDate === '2024-06' && s.linkHeadings?.length === s.linkPanoIds.length)).toBe(true);
    expect(progress.at(-1)).toBe(result.callsUsed);

    // The saved graph is drivable end to end by the planner.
    const graph = buildLinkGraph(toNodes(saved));
    const destination = L_ROUTE.polyline[4]!;
    let at = saved[0]!.panoId;
    for (let i = 0; i < 100; i++) {
      const plan = planOfflineHop(graph, at, destination);
      if (!plan || plan.kind === 'arrived') break;
      expect(plan.kind).toBe('astar');
      at = plan.next.panoId;
    }
    expect(['s18', 's19', 's20']).toContain(at);
  });

  it('re-enters the route by location across a missing link', async () => {
    const graph = buildGraph();
    // Break Main Street between m10 and m11.
    graph.get('m10')!.links = graph.get('m10')!.links.filter((l) => l !== 'm11');
    graph.get('m11')!.links = graph.get('m11')!.links.filter((l) => l !== 'm10');
    const { service, requests } = fakeService(graph);
    let saved: PanoLinkSnapshot[] = [];
    const result = await prefetchTripGraph(route, service, {
      budget: new MapsCallBudget(),
      save: async (_id, snaps) => { saved = snaps; },
    });
    expect(result.stop).toBe('complete');
    expect(requests.filter((r) => r === 'location').length).toBe(2);
    expect(saved.map((s) => s.panoId)).toContain('s18');
  });

  it('stops cleanly at the session cap and still saves what it gathered', async () => {
    const { service, requests } = fakeService(buildGraph());
    const budget = new MapsCallBudget({ panorama: 12 });
    let saved: PanoLinkSnapshot[] = [];
    const result = await prefetchTripGraph(route, service, {
      budget,
      save: async (_id, snaps) => { saved = snaps; },
    });
    expect(result.stop).toBe('budget');
    expect(requests).toHaveLength(12);
    expect(result.callsUsed).toBe(12);
    expect(saved).toHaveLength(12);
    expect(budget.getStats().byKind.panorama.blocked).toBe(1);
    expect(result.coveredM).toBeLessThan(route.lengthM);
  });

  it('stops when aborted and reports no imagery near the start', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service, requests } = fakeService(buildGraph());
    expect((await prefetchTripGraph(route, service, { signal: controller.signal, save: async () => {} })).stop).toBe('aborted');
    expect(requests).toHaveLength(0);

    const empty = fakeService(new Map());
    const none = await prefetchTripGraph(route, empty.service, { budget: new MapsCallBudget(), save: async () => {} });
    expect(none.stop).toBe('no-imagery');
    expect(none.nodes).toBe(0);
  });
});
