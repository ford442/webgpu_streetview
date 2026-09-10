import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useCruiseMode } from '../useCruiseMode';

/**
 * Cruise commits the view heading as its travel direction. When that heading
 * points off-road — engaged while facing a building, or a bend the last hop's
 * bearing overshot — no link sits inside the tight manual cone and the hop
 * used to do nothing at all, burning the 3-strike stuck-hop budget until
 * cruise auto-disabled. Cruise now re-aims onto the nearest link first.
 */

function makeHarness(linkHeadings: number[]) {
  let index = 0;
  const ids = ['a', 'b', 'c', 'd'];
  return {
    pano: {
      getPano: () => ids[Math.min(index, ids.length - 1)],
      getPosition: () => null,
      getLinks: () => linkHeadings.map((heading) => ({ heading, pano: `link-${heading}` })),
    } as unknown as google.maps.StreetViewPanorama,
    step: () => {
      index++;
    },
  };
}

/** Engage cruise, run exactly one tick, and report the heading it hopped with. */
async function runOneTick(harness: ReturnType<typeof makeHarness>, viewHeading: number) {
  const headings: (number | undefined)[] = [];
  const advanceSafe = vi.fn(
    async (
      _dir: 'forward',
      _target?: { lat: number; lng: number },
      heading?: number
    ) => {
      headings.push(heading);
      harness.step();
    }
  );
  const view = renderHook(() =>
    useCruiseMode({
      panorama: harness.pano,
      advanceSafe,
      mapsAuthFailed: false,
      heading: viewHeading,
      isTransitioning: false,
      setNavPending: () => {},
      hopsPerTick: () => 1,
    })
  );
  act(() => view.result.current.setIsCruiseMode(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  act(() => view.result.current.setIsCruiseMode(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  return headings;
}

describe('useCruiseMode re-aims onto the road', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('leaves the committed heading alone when a link is already in the cone', async () => {
    // Road runs at 20°, cruise engaged at 10° — inside the 45° manual cone.
    const headings = await runOneTick(makeHarness([20, 200]), 10);
    expect(headings).toEqual([10]);
  });

  it('snaps to the nearest link when the driver faces a wall', async () => {
    // Engaged at 90° (perpendicular to a road that runs 0°/180°): nothing is
    // within 45°, so the hop used to no-op. Re-aim to the 0° link.
    const headings = await runOneTick(makeHarness([0, 180]), 90);
    expect(headings).toEqual([0]);
  });

  it('re-aims across the 0/360 seam', async () => {
    const headings = await runOneTick(makeHarness([350, 170]), 60);
    expect(headings).toEqual([350]);
  });

  it('does not U-turn when the only link is behind', async () => {
    // A dead end faced outward: the single link is 180° behind, outside the
    // re-aim cone. Cruise keeps its heading and the hop reports no movement.
    const headings = await runOneTick(makeHarness([180]), 0);
    expect(headings).toEqual([0]);
  });

  it('tolerates a panorama with no getLinks (older stub / no links yet)', async () => {
    const harness = makeHarness([]);
    (harness.pano as unknown as { getLinks?: unknown }).getLinks = undefined;
    const headings = await runOneTick(harness, 42);
    expect(headings).toEqual([42]);
  });
});
