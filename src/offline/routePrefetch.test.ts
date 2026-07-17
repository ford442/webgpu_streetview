import { buildRouteGraphNodes } from './routePrefetch';

describe('routePrefetch', () => {
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
});
