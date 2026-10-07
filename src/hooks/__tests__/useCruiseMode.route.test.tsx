// @vitest-environment jsdom
/**
 * Route-following cruise end to end, against a synthetic Street View graph:
 * the trip controller plans an L-shaped route, cruise follows it hop by hop,
 * turns at the corner, and stops at the destination — with zero
 * `getPanorama` calls on-route (the hop is `getLinks()` + `setPano()` only),
 * and exactly one metered re-snap when it is put off the route.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { povStore } from '../../state/povStore';
import { tripStore } from '../../state/tripStore';
import { getMapsCallBudget, resetMapsCallBudgetForTests } from '../../services/maps/callBudget';
import {
  configureTripController,
  getActiveRouteGuide,
  planTrip,
  resetTripControllerForTests,
  startDrive,
} from '../../services/routing/tripController';
import type { RouteProvider } from '../../services/routing/RouteProvider';
import { absoluteAngleDiff } from '../../utils/navigation';
import { DESTINATION, L_ROUTE, ORIGIN, buildGraph, linksOf } from '../../services/routing/__tests__/routeFixtures';
import { useCruiseMode } from '../useCruiseMode';

const latLng = (p: { lat: number; lng: number }) => ({ lat: () => p.lat, lng: () => p.lng }) as google.maps.LatLng;

function harness(start: string) {
  const graph = buildGraph();
  let at = start;
  const panorama = {
    getPano: () => at,
    getPosition: () => latLng(graph.get(at)!.pos),
    getLinks: () => linksOf(graph, at),
  } as unknown as google.maps.StreetViewPanorama;
  // advance('forward', heading) picks the link at that heading, as the real one does.
  const advanceSafe = vi.fn(async (_dir: 'forward', target?: unknown, heading?: number) => {
    expect(target).toBeUndefined(); // no target hint → no pano prefetch
    const link = linksOf(graph, at).find((l) => absoluteAngleDiff(l.heading, heading ?? -999) < 45);
    if (link) at = link.pano;
  });
  return { graph, panorama, advanceSafe, moveTo: (id: string) => { at = id; }, current: () => at };
}

const provider: RouteProvider = { id: 'test', billable: false, route: async () => L_ROUTE };

const getPanorama = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  povStore.reset({ heading: 0 });
  resetMapsCallBudgetForTests();
  resetTripControllerForTests();
  getPanorama.mockReset();
  (globalThis as unknown as { google: unknown }).google = {
    maps: { StreetViewService: class { getPanorama = getPanorama; } },
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  resetTripControllerForTests();
  delete (globalThis as { google?: unknown }).google;
});

async function plan(h: ReturnType<typeof harness>) {
  await planTrip([{ ...ORIGIN, label: 'Start' }, { ...DESTINATION, label: 'End' }], provider);
  expect(tripStore.get().status).toBe('ready');
  expect(startDrive(h.graph.get(h.current())!.pos)).toBe(true);
}

function mountCruise(h: ReturnType<typeof harness>) {
  const view = renderHook(() =>
    useCruiseMode({
      panorama: h.panorama,
      advanceSafe: h.advanceSafe,
      mapsAuthFailed: false,
      isTransitioning: false,
      setNavPending: () => {},
      hopsPerTick: () => 1,
      routeGuide: getActiveRouteGuide,
    }),
  );
  act(() => view.result.current.setIsCruiseMode(true));
  return view;
}

describe('route-following cruise', () => {
  it('follows the route through the turn to arrival with zero extra Maps calls', async () => {
    const h = harness('m0');
    await plan(h);
    const view = mountCruise(h);
    const visited = new Set<string>();
    for (let tick = 0; tick < 70 && view.result.current.isCruiseMode; tick++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      visited.add(h.current());
    }
    expect(visited.has('s1')).toBe(true);
    expect(visited.has('m31')).toBe(false);
    expect(view.result.current.isCruiseMode).toBe(false);
    expect(tripStore.get().status).toBe('arrived');
    expect(tripStore.get().summary).toMatchObject({ resnaps: 0 });
    expect(getPanorama).not.toHaveBeenCalled();
    expect(getMapsCallBudget().getStats().byKind.panorama.used).toBe(0);
    // ~48 hops of getLinks + setPano, nothing else.
    expect(h.advanceSafe.mock.calls.length).toBeGreaterThan(40);
  });

  it('re-snaps once (metered) when the car is off the route, then carries on', async () => {
    const h = harness('m0');
    await plan(h);
    const resnapTo = vi.fn(async () => {
      // Stand-in for getPanorama + teleportToPano through the hold-pause path.
      expect(getMapsCallBudget().tryConsume('panorama', 'route-resnap')).toBe(true);
      h.moveTo('m14');
      return true;
    });
    configureTripController({ resnapTo });
    const view = mountCruise(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // Put the car 50 m past the corner on Main Street: off the route.
    h.moveTo('m35');
    for (let tick = 0; tick < 4; tick++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(resnapTo).toHaveBeenCalledTimes(1);
    expect(tripStore.get().resnaps).toBe(1);
    expect(getMapsCallBudget().getStats().byKind.panorama.used).toBe(1);
    act(() => view.result.current.setIsCruiseMode(false));
  });
});
