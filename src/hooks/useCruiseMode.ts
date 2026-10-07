import { povStore } from '../state/povStore';
import { useRef, useEffect, useState } from 'react';
import { findBestOfflineLink } from '../offline';
import type { RouteGraphNode } from '../offline';
import { gearChainedHopIntervalMs } from '../car/VehicleDynamics';
import { isGeocodeDenied } from '../search/geocodeAuth';
import { DEFAULT_LINK_CONE_DEG, findBestLink, initialBearing } from '../utils/navigation';
import type { RouteHopDecision } from '../services/routing/routeFollow';
import type { LatLng } from '../services/routing/RouteProvider';

/**
 * Route guidance for a routed road trip (`app/useTripBindings.ts`). Cruise asks
 * it which way to go before each hop; it never makes a Maps call on-route.
 */
export interface CruiseRouteGuide {
  planHop(position: LatLng, links: readonly google.maps.StreetViewLink[]): RouteHopDecision;
  /** After every hop attempt, with the pano position it ended on. */
  afterHop(position: LatLng | null, moved: boolean): void;
  /** One metered re-snap to a route point; resolves true when the pano moved there. */
  resnap(target: LatLng): Promise<boolean>;
  arrived(): void;
}

export interface UseCruiseModeOptions {
  panorama: google.maps.StreetViewPanorama | null;
  advanceSafe: (dir: 'forward', targetLatLng?: { lat: number; lng: number }, heading?: number) => Promise<void>;
  mapsAuthFailed: boolean;
  isTransitioning: boolean;
  setNavPending: (pending: boolean) => void;
  /**
   * Optional loader for previously-prefetched route-graph nodes (see
   * `useRoutePrefetch`). When provided, cruise mode loads them once per
   * cruise session and uses them to pre-warm the likely next panorama —
   * useful when the connection is flaky and a live `getLinks()` round trip
   * is slow. Purely a pre-fetch hint; the live link lookup still decides
   * the actual hop.
   */
  loadOfflineRouteGraphNodes?: () => Promise<RouteGraphNode[]>;
  /**
   * Panorama hops to consume per cruise tick, read fresh on every tick so a
   * mid-cruise gear change takes effect immediately. `0` (P/N) parks the car:
   * cruise stays engaged but no hop is issued. Defaults to a single hop.
   */
  hopsPerTick?: () => number;
  /**
   * The active route guide, read fresh each hop (null = greedy cruise). With a
   * guide, each hop aims at the link that tracks the route instead of the
   * committed heading — same `getLinks` + `setPano`, no extra API calls.
   */
  routeGuide?: () => CruiseRouteGuide | null;
}

type HopOutcome = 'moved' | 'stuck' | 'arrived';

const toLatLng = (p: google.maps.LatLng | null): LatLng | null =>
  p ? { lat: p.lat(), lng: p.lng() } : null;

/**
 * Cone cruise is allowed to re-aim into when no link sits inside the tight
 * manual cone. Wide enough to round a corner or to leave a pano the driver
 * engaged cruise on while facing a wall, narrow enough that cruise never
 * U-turns into oncoming travel.
 */
export const CRUISE_REAIM_CONE_DEG = 100;

/** Spacing between the extra hops a 2/3 gear queues within one cruise tick. */
export const CRUISE_CHAINED_HOP_INTERVAL_MS = 550;

/** Initial bearing (degrees, 0–360) from point A to point B. */
function bearingBetween(
  from: google.maps.LatLng,
  to: google.maps.LatLng
): number {
  return initialBearing(from.lat(), from.lng(), to.lat(), to.lng());
}

export function useCruiseMode({
  panorama,
  advanceSafe,
  mapsAuthFailed,
  isTransitioning,
  setNavPending,
  loadOfflineRouteGraphNodes,
  hopsPerTick,
  routeGuide,
}: UseCruiseModeOptions) {
  const [isCruiseMode, setIsCruiseMode] = useState(false);
  const offlineNodesRef = useRef<RouteGraphNode[]>([]);

  // The live view heading (povStore — head-look moves it without a render) is
  // NOT the travel direction. It only seeds the committed heading when cruise starts.

  // Committed travel heading. Frozen against passive head-look so that looking
  // around in free-look/car mode never redirects cruise. Self-corrects to the
  // road after each successful hop via the position-change bearing.
  const cruiseHeadingRef = useRef(povStore.get().heading);

  const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const useTransitionRef = useRef(isTransitioning);
  useTransitionRef.current = isTransitioning;
  const cruiseFailCountRef = useRef(0);
  // A multi-hop tick can outlast the tick interval; this keeps ticks serial.
  const hopInFlightRef = useRef(false);
  const hopsPerTickRef = useRef(hopsPerTick);
  hopsPerTickRef.current = hopsPerTick;
  const routeGuideRef = useRef(routeGuide);
  routeGuideRef.current = routeGuide;
  // AppShell re-renders on scraper self-check (~2s) and look-around, which
  // recreates `advanceSafe`. The hop interval must not restart on that
  // identity churn — 2s < 3s meant cruise never issued a hop.
  const advanceSafeRef = useRef(advanceSafe);
  advanceSafeRef.current = advanceSafe;

  useEffect(() => {
    if (!isCruiseMode || !panorama) {
      if (cruiseIntervalRef.current) {
        clearInterval(cruiseIntervalRef.current);
        cruiseIntervalRef.current = null;
      }
      cruiseFailCountRef.current = 0;
      hopInFlightRef.current = false;
      return;
    }
    // Commit the current view heading as the travel direction the moment cruise
    // engages. From here it evolves only from real movement, not head-look.
    cruiseHeadingRef.current = povStore.get().heading;
    // Load any previously-prefetched route graphs once per cruise session so a
    // flaky connection doesn't pay an IndexedDB round trip on every hop.
    offlineNodesRef.current = [];
    if (loadOfflineRouteGraphNodes) {
      loadOfflineRouteGraphNodes()
        .then((nodes) => {
          offlineNodesRef.current = nodes;
        })
        .catch((err) => console.warn('[CruiseMode] Failed to load offline route graph nodes', err));
    }
    /**
     * Graph walk: getLinks → heading nearest cruiseHeadingRef → setPano.
     * Must not call Geocoder. `advanceSafe` is Street View links only.
     */
    const singleHop = async (): Promise<HopOutcome> => {
      const panoIdBefore = panorama.getPano();
      const posBefore = panorama.getPosition() ?? null;
      const guide = routeGuideRef.current?.() ?? null;
      const here = toLatLng(posBefore);
      if (guide && here) return routeHop(guide, here, panoIdBefore);
      // Prefer a known next pano from a prefetched route graph, if we have
      // one for the current location — pre-warms the pano cache so the hop
      // stays smooth even when the live `getLinks()` round trip is slow.
      let targetHint: { lat: number; lng: number } | undefined;
      if (panoIdBefore && offlineNodesRef.current.length > 0) {
        const bestOffline = findBestOfflineLink(offlineNodesRef.current, panoIdBefore, cruiseHeadingRef.current);
        if (bestOffline) targetHint = { lat: bestOffline.lat, lng: bestOffline.lng };
      }
      // The committed heading can point off-road — cruise engaged while facing
      // a building, or a bend the last hop's bearing overshot. Manual hops keep
      // the tight cone and simply do nothing; cruise instead re-aims onto the
      // nearest link inside a wider cone so a hop happens and the road is
      // followed, rather than burning the 3-strike stuck-hop budget.
      const links = (panorama.getLinks?.() ?? [])
        .filter((link): link is google.maps.StreetViewLink => link != null);
      if (links.length > 0 && !findBestLink(links, cruiseHeadingRef.current, 'forward')) {
        const reaimed = findBestLink(
          links,
          cruiseHeadingRef.current,
          'forward',
          CRUISE_REAIM_CONE_DEG
        );
        if (reaimed?.heading != null) {
          console.log(
            `[CruiseMode] No link within ${DEFAULT_LINK_CONE_DEG}° — re-aiming ` +
              `${Math.round(cruiseHeadingRef.current)}° → ${Math.round(reaimed.heading)}°`
          );
          cruiseHeadingRef.current = reaimed.heading;
        }
      }

      setNavPending(true);
      try {
        await advanceSafeRef.current('forward', targetHint, cruiseHeadingRef.current);
      } finally {
        setNavPending(false);
      }
      await new Promise(r => setTimeout(r, 1500));
      const panoIdAfter = panorama.getPano();
      if (panoIdAfter && panoIdAfter !== panoIdBefore) {
        // Follow the road: steer future hops along the direction actually
        // travelled, independent of where the head is looking.
        const posAfter = panorama.getPosition() ?? null;
        if (posBefore && posAfter) {
          cruiseHeadingRef.current = bearingBetween(posBefore, posAfter);
        }
        return 'moved';
      }
      return 'stuck';
    };

    /**
     * Routed hop: the guide picks the link that tracks the route (no target
     * hint, so no pano prefetch — on-route hops make zero extra Maps calls),
     * asks for one metered re-snap when off the route, or ends the trip.
     */
    const routeHop = async (
      guide: CruiseRouteGuide,
      here: LatLng,
      panoIdBefore: string,
    ): Promise<HopOutcome> => {
      const links = (panorama.getLinks?.() ?? [])
        .filter((link): link is google.maps.StreetViewLink => link != null);
      const decision = guide.planHop(here, links);
      if (decision.kind === 'arrived') {
        guide.arrived();
        setIsCruiseMode(false);
        return 'arrived';
      }
      setNavPending(true);
      try {
        if (decision.kind === 'resnap') {
          console.log(`[CruiseMode] Off route (${decision.reason}) — re-snapping ahead`);
          await guide.resnap(decision.target);
        } else {
          cruiseHeadingRef.current = decision.heading;
          await advanceSafeRef.current('forward', undefined, decision.heading);
        }
      } finally {
        setNavPending(false);
      }
      await new Promise(r => setTimeout(r, 1500));
      const moved = Boolean(panorama.getPano()) && panorama.getPano() !== panoIdBefore;
      guide.afterHop(toLatLng(panorama.getPosition() ?? null), moved);
      return moved ? 'moved' : 'stuck';
    };

    const hop = async () => {
      if (hopInFlightRef.current) return;
      if (useTransitionRef.current) {
        console.log('[CruiseMode] Skipping hop - still transitioning');
        return;
      }
      if (mapsAuthFailed) {
        console.warn('[CruiseMode] Disabling — Maps auth failed');
        setIsCruiseMode(false);
        return;
      }

      // Gear decides how far one tick travels: P/N park, D one hop, 2/3 chain
      // two or three. Read fresh each tick so shifting takes effect at once.
      const hops = hopsPerTickRef.current ? hopsPerTickRef.current() : 1;
      if (hops <= 0) {
        console.log('[CruiseMode] Skipping hop — gear parked (P/N)');
        return;
      }

      hopInFlightRef.current = true;
      let movedAny = false;
      let arrived = false;
      try {
        for (let i = 0; i < hops; i++) {
          // Re-read the gear between chained hops so shifting into P/N (or
          // disengaging cruise) stops the chain instead of finishing it.
          if (i > 0) {
            await new Promise(r => setTimeout(r, gearChainedHopIntervalMs(hops)));
            if (hopsPerTickRef.current && hopsPerTickRef.current() <= 0) break;
          }
          const outcome = await singleHop();
          if (outcome === 'arrived') {
            arrived = true;
            break;
          }
          movedAny = movedAny || outcome === 'moved';
          // Dead end: no point spending the remaining hops of this tick.
          if (outcome !== 'moved') break;
        }
      } finally {
        hopInFlightRef.current = false;
      }

      if (arrived) {
        cruiseFailCountRef.current = 0;
      } else if (movedAny) {
        cruiseFailCountRef.current = 0;
      } else if (isGeocodeDenied()) {
        // Address lookup is not the hop. Denial is logged once in geocodeAuth.
      } else {
        cruiseFailCountRef.current += 1;
        console.warn(`[CruiseMode] Hop did not advance (${cruiseFailCountRef.current}/3)`);
        if (cruiseFailCountRef.current >= 3) {
          console.error('[CruiseMode] 3 consecutive stuck hops — auto-disabling cruise mode');
          setIsCruiseMode(false);
          cruiseFailCountRef.current = 0;
        }
      }
    };
    void hop();
    cruiseIntervalRef.current = setInterval(hop, 3000);
    return () => {
      if (cruiseIntervalRef.current) clearInterval(cruiseIntervalRef.current);
      cruiseIntervalRef.current = null;
      hopInFlightRef.current = false;
    };
    // Hop callbacks (`advanceSafe`, `setNavPending`, route-graph loader) are
    // read from refs. Restarting this effect when they change is what used to
    // cancel the 3s interval on every AppShell render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCruiseMode, panorama, mapsAuthFailed]);

  return { isCruiseMode, setIsCruiseMode };
}
