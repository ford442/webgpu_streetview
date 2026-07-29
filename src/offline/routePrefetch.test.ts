import { vi } from 'vitest';
import {
  buildRouteGraphNodes,
  prefetchRouteGraph,
  createStreetViewLinkCollector,
  type PanoLinkSnapshot,
  type RoutePrefetchProgress,
  type StreetViewServiceLike,
} from './routePrefetch';

const { offlineSaveRouteGraph } = vi.hoisted(() => ({
  offlineSaveRouteGraph: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./offlineStore', () => ({ offlineSaveRouteGraph }));

describe('routePrefetch', () => {
  beforeEach(() => {
    offlineSaveRouteGraph.mockClear();
  });

  it('builds route graph nodes from pano link snapshots', () => {
    const nodes = buildRouteGraphNodes('route-1', [
      {
        panoId: 'pano-a',
        lat: 37.1,
        lng: -122.1,
        linkPanoIds: ['pano-b', 'pano-c'],
      },
      {
        panoId: 'pano-b',
        lat: 37.2,
        lng: -122.2,
        linkPanoIds: ['pano-a'],
      },
    ]);

    expect(nodes).toHaveLength(2);
    const first = nodes[0]!;
    const second = nodes[1]!;
    expect(first.panoId).toBe('pano-a');
    expect(first.linkPanoIds).toEqual(['pano-b', 'pano-c']);
    expect(second.lat).toBe(37.2);
  });

  describe('prefetchRouteGraph', () => {
    it('collects links at every waypoint and persists a non-empty graph', async () => {
      const snapshotsByWaypoint: Record<string, PanoLinkSnapshot> = {
        '37.1,-122.1': { panoId: 'pano-a', lat: 37.1, lng: -122.1, linkPanoIds: ['pano-b'] },
        '37.2,-122.2': { panoId: 'pano-b', lat: 37.2, lng: -122.2, linkPanoIds: ['pano-a', 'pano-c'] },
      };
      const collectLinksAt = vi.fn(async (waypoint: { lat: number; lng: number }) => {
        return snapshotsByWaypoint[`${waypoint.lat},${waypoint.lng}`] ?? null;
      });

      const progressEvents: RoutePrefetchProgress[] = [];
      const count = await prefetchRouteGraph(
        {
          routeId: 'route-1',
          waypoints: [
            { lat: 37.1, lng: -122.1 },
            { lat: 37.2, lng: -122.2 },
          ],
        },
        collectLinksAt,
        (progress) => progressEvents.push(progress),
      );

      expect(collectLinksAt).toHaveBeenCalledTimes(2);
      expect(count).toBe(2);
      expect(offlineSaveRouteGraph).toHaveBeenCalledTimes(1);
      const [routeId, savedNodes] = offlineSaveRouteGraph.mock.calls[0]!;
      expect(routeId).toBe('route-1');
      expect(savedNodes).toHaveLength(2);
      expect(savedNodes.map((n: PanoLinkSnapshot) => n.panoId).sort()).toEqual(['pano-a', 'pano-b']);

      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0]).toEqual({
        routeId: 'route-1',
        totalSteps: 2,
        completedSteps: 1,
        currentPanoId: 'pano-a',
      });
      expect(progressEvents[1]).toEqual({
        routeId: 'route-1',
        totalSteps: 2,
        completedSteps: 2,
        currentPanoId: 'pano-b',
      });
    });

    it('dedupes snapshots that resolve to the same panoId', async () => {
      const collectLinksAt = vi.fn(async () => ({
        panoId: 'pano-shared',
        lat: 1,
        lng: 2,
        linkPanoIds: [] as string[],
      }));

      const count = await prefetchRouteGraph(
        { routeId: 'route-dupe', waypoints: [{ lat: 1, lng: 2 }, { lat: 1.0001, lng: 2.0001 }] },
        collectLinksAt,
      );

      expect(count).toBe(1);
      const [, savedNodes] = offlineSaveRouteGraph.mock.calls[0]!;
      expect(savedNodes).toHaveLength(1);
    });

    it('skips a waypoint whose collector throws or returns null without aborting the run', async () => {
      const collectLinksAt = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ panoId: 'pano-ok', lat: 3, lng: 4, linkPanoIds: [] });

      const progressEvents: RoutePrefetchProgress[] = [];
      const count = await prefetchRouteGraph(
        {
          routeId: 'route-flaky',
          waypoints: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
        },
        collectLinksAt,
        (progress) => progressEvents.push(progress),
      );

      expect(count).toBe(1);
      expect(progressEvents).toHaveLength(3);
      expect(progressEvents[2]).toEqual({
        routeId: 'route-flaky',
        totalSteps: 3,
        completedSteps: 3,
        currentPanoId: 'pano-ok',
      });
    });

    it('still saves (an empty) graph when every waypoint fails to resolve', async () => {
      const collectLinksAt = vi.fn().mockResolvedValue(null);
      const count = await prefetchRouteGraph(
        { routeId: 'route-empty', waypoints: [{ lat: 0, lng: 0 }] },
        collectLinksAt,
      );
      expect(count).toBe(0);
      expect(offlineSaveRouteGraph).toHaveBeenCalledWith('route-empty', []);
    });
  });

  describe('createStreetViewLinkCollector', () => {
    it('resolves a snapshot from a StreetViewService-shaped getPanorama call', async () => {
      const service: StreetViewServiceLike = {
        getPanorama: (_request, callback) => {
          callback(
            {
              location: { pano: 'pano-a', latLng: { lat: () => 37.1, lng: () => -122.1 } },
              links: [{ pano: 'pano-b' }, { pano: null }, null],
            },
            'OK',
          );
        },
      };
      const collect = createStreetViewLinkCollector(service);
      const snapshot = await collect({ lat: 37.1, lng: -122.1 });
      expect(snapshot).toEqual({
        panoId: 'pano-a',
        lat: 37.1,
        lng: -122.1,
        linkPanoIds: ['pano-b'],
      });
    });

    it('resolves null when the service reports a non-OK status', async () => {
      const service: StreetViewServiceLike = {
        getPanorama: (_request, callback) => callback(null, 'ZERO_RESULTS'),
      };
      const collect = createStreetViewLinkCollector(service);
      const snapshot = await collect({ lat: 0, lng: 0 });
      expect(snapshot).toBeNull();
    });

    it('passes the configured search radius through to the service', async () => {
      const getPanorama = vi.fn((_request, callback) => callback(null, 'ZERO_RESULTS'));
      const collect = createStreetViewLinkCollector({ getPanorama }, { radiusMeters: 200 });
      await collect({ lat: 1, lng: 2 });
      expect(getPanorama).toHaveBeenCalledWith(
        expect.objectContaining({ location: { lat: 1, lng: 2 }, radius: 200 }),
        expect.any(Function),
      );
    });
  });
});
