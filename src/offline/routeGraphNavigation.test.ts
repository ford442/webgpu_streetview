import { findBestOfflineLink, findPathBetweenPanos } from './routeGraphNavigation';
import type { RouteGraphNode } from './offlineStore';

function node(partial: Partial<RouteGraphNode> & { panoId: string }): RouteGraphNode {
  return {
    lat: 0,
    lng: 0,
    linkPanoIds: [],
    routeId: 'route-1',
    cachedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('findBestOfflineLink', () => {
  it('returns the neighbor whose bearing is closest to the target heading', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'start', lat: 0, lng: 0, linkPanoIds: ['north', 'east'] }),
      node({ panoId: 'north', lat: 1, lng: 0 }),
      node({ panoId: 'east', lat: 0, lng: 1 }),
    ];

    const best = findBestOfflineLink(nodes, 'start', 0);
    expect(best?.panoId).toBe('north');

    const bestEast = findBestOfflineLink(nodes, 'start', 90);
    expect(bestEast?.panoId).toBe('east');
  });

  it('returns null when the current pano is not in the graph', () => {
    const nodes: RouteGraphNode[] = [node({ panoId: 'other' })];
    expect(findBestOfflineLink(nodes, 'missing', 0)).toBeNull();
  });

  it('returns null when no neighbor is within the heading tolerance', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'start', lat: 0, lng: 0, linkPanoIds: ['south'] }),
      node({ panoId: 'south', lat: -1, lng: 0 }),
    ];
    // south is ~180 degrees away from a target heading of due north (0).
    expect(findBestOfflineLink(nodes, 'start', 0)).toBeNull();
  });

  it('ignores linked panoIds that have no corresponding node', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'start', lat: 0, lng: 0, linkPanoIds: ['ghost', 'north'] }),
      node({ panoId: 'north', lat: 1, lng: 0 }),
    ];
    expect(findBestOfflineLink(nodes, 'start', 0)?.panoId).toBe('north');
  });
});

describe('findPathBetweenPanos', () => {
  it('returns an empty path when start equals destination', () => {
    expect(findPathBetweenPanos([node({ panoId: 'a' })], 'a', 'a')).toEqual([]);
  });

  it('finds a direct single-hop path', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'a', linkPanoIds: ['b'] }),
      node({ panoId: 'b', linkPanoIds: ['a'] }),
    ];
    const path = findPathBetweenPanos(nodes, 'a', 'b');
    expect(path?.map((n) => n.panoId)).toEqual(['b']);
  });

  it('finds a multi-hop path through intermediate nodes', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'a', linkPanoIds: ['b'] }),
      node({ panoId: 'b', linkPanoIds: ['a', 'c'] }),
      node({ panoId: 'c', linkPanoIds: ['b', 'd'] }),
      node({ panoId: 'd', linkPanoIds: ['c'] }),
    ];
    const path = findPathBetweenPanos(nodes, 'a', 'd');
    expect(path?.map((n) => n.panoId)).toEqual(['b', 'c', 'd']);
  });

  it('returns null when the destination is unreachable', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'a', linkPanoIds: ['b'] }),
      node({ panoId: 'b', linkPanoIds: ['a'] }),
      node({ panoId: 'isolated', linkPanoIds: [] }),
    ];
    expect(findPathBetweenPanos(nodes, 'a', 'isolated')).toBeNull();
  });

  it('returns null when either endpoint is missing from the graph', () => {
    const nodes: RouteGraphNode[] = [node({ panoId: 'a', linkPanoIds: ['b'] })];
    expect(findPathBetweenPanos(nodes, 'a', 'missing')).toBeNull();
    expect(findPathBetweenPanos(nodes, 'missing', 'a')).toBeNull();
  });

  it('respects maxHops and gives up beyond it', () => {
    const nodes: RouteGraphNode[] = [
      node({ panoId: 'a', linkPanoIds: ['b'] }),
      node({ panoId: 'b', linkPanoIds: ['c'] }),
      node({ panoId: 'c', linkPanoIds: ['d'] }),
      node({ panoId: 'd', linkPanoIds: [] }),
    ];
    expect(findPathBetweenPanos(nodes, 'a', 'd', 2)).toBeNull();
    expect(findPathBetweenPanos(nodes, 'a', 'd', 3)?.map((n) => n.panoId)).toEqual(['b', 'c', 'd']);
  });
});
