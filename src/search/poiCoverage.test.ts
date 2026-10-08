import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPoiCoverage, resetPoiCoverageCacheForTests, type PoiCoverageLookup } from './poiCoverage';
import type { NearbyPoi } from './poiModel';
import type { PanoGraphNode } from '../services/maps/panoCoverageGraph';

const poi = (id: string, lat: number, lng: number): NearbyPoi => ({ id, lat, lng, label: id, category: 'food' });

afterEach(() => resetPoiCoverageCacheForTests());

describe('classifyPoiCoverage', () => {
  it('answers from a graph node within 50 m without a lookup', async () => {
    const lookup = vi.fn<PoiCoverageLookup>();
    const nodes: PanoGraphNode[] = [{ panoId: 'p1', lat: 0, lng: 0, links: [] }];
    const out = await classifyPoiCoverage([poi('near', 0, 0.0003)], lookup, nodes);
    expect(out.get('near')).toMatchObject({ status: 'covered', panoId: 'p1' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks up the rest once each, with a 50 m radius, and caches answers', async () => {
    const lookup = vi.fn<PoiCoverageLookup>(async (lat) =>
      lat > 1 ? { status: 'none' } : { status: 'covered', panoId: 'p2' },
    );
    const pois = [poi('a', 0.5, 0), poi('b', 2, 0)];
    const out = await classifyPoiCoverage(pois, lookup);
    expect(out.get('a')?.status).toBe('covered');
    expect(out.get('b')?.status).toBe('none');
    expect(lookup).toHaveBeenCalledWith(0.5, 0, 50);
    lookup.mockClear();
    await classifyPoiCoverage(pois, lookup);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('caps lookups per batch and leaves the remainder unknown', async () => {
    const lookup = vi.fn<PoiCoverageLookup>(async () => ({ status: 'none' }));
    const out = await classifyPoiCoverage([poi('a', 1, 1), poi('b', 2, 2), poi('c', 3, 3)], lookup, [], 2);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(out.get('c')?.status).toBe('unknown');
  });

  it('does not cache a failed lookup (budget refused / error)', async () => {
    const lookup = vi.fn<PoiCoverageLookup>(async () => null);
    await classifyPoiCoverage([poi('a', 1, 1)], lookup);
    await classifyPoiCoverage([poi('a', 1, 1)], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
