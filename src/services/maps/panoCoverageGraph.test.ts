import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPanoGraphSessionLookups,
  nearestGraphNode,
  resetPanoGraphCacheForTests,
  walkPanoGraph,
  type PanoGraphNode,
} from './panoCoverageGraph';

/** A straight street a–b–c–d–e (each ~11 m apart) with a side branch c–x. */
const STREET: Record<string, PanoGraphNode> = {
  a: { panoId: 'a', lat: 0, lng: 0.0000, links: ['b'] },
  b: { panoId: 'b', lat: 0, lng: 0.0001, links: ['a', 'c'] },
  c: { panoId: 'c', lat: 0, lng: 0.0002, links: ['b', 'd', 'x'] },
  d: { panoId: 'd', lat: 0, lng: 0.0003, links: ['c', 'e'] },
  e: { panoId: 'e', lat: 0, lng: 0.0004, links: ['d'] },
  x: { panoId: 'x', lat: 0.0001, lng: 0.0002, links: ['c'] },
};

const fetcher = () => vi.fn(async (id: string) => STREET[id] ?? null);

afterEach(() => resetPanoGraphCacheForTests());

describe('walkPanoGraph', () => {
  it('walks links breadth-first up to maxHops and keeps only in-graph edges', async () => {
    const fetch = fetcher();
    const g = await walkPanoGraph('a', fetch, { maxHops: 2 });
    expect(g.nodes.map((n) => n.panoId).sort()).toEqual(['a', 'b', 'c']);
    expect(g.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
    expect(g.lookups).toBe(3);
    expect(g.truncated).toBe(false);
  });

  it('caches nodes for the session, so re-centring only pays for the new frontier', async () => {
    const fetch = fetcher();
    await walkPanoGraph('a', fetch, { maxHops: 2 });
    fetch.mockClear();
    const g = await walkPanoGraph('c', fetch, { maxHops: 1 });
    expect(g.nodes.map((n) => n.panoId).sort()).toEqual(['b', 'c', 'd', 'x']);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['d', 'x']);
    expect(g.lookups).toBe(2);
  });

  it('stops at maxNodes and reports truncation', async () => {
    const g = await walkPanoGraph('a', fetcher(), { maxHops: 10, maxNodes: 3 });
    expect(g.nodes).toHaveLength(3);
    expect(g.truncated).toBe(true);
  });

  it('honours the session lookup cap', async () => {
    const fetch = fetcher();
    const g = await walkPanoGraph('a', fetch, { maxHops: 10, maxSessionLookups: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(g.nodes.map((n) => n.panoId)).toEqual(['a', 'b']);
    expect(g.truncated).toBe(true);
    expect(getPanoGraphSessionLookups()).toBe(2);
  });

  it('skips panos the fetcher cannot resolve (budget refused, no data)', async () => {
    const fetch = vi.fn(async (id: string) => (id === 'b' ? null : STREET[id] ?? null));
    const g = await walkPanoGraph('a', fetch, { maxHops: 3 });
    expect(g.nodes.map((n) => n.panoId)).toEqual(['a']);
    expect(g.edges).toEqual([]);
  });
});

describe('nearestGraphNode', () => {
  it('finds the closest node within the radius', () => {
    const nodes = Object.values(STREET);
    expect(nearestGraphNode(nodes, 0, 0.00021, 50)?.panoId).toBe('c');
    expect(nearestGraphNode(nodes, 0.01, 0, 50)).toBeNull();
  });
});
