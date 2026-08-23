import { useRef, useEffect, useState } from 'react';
import { findBestOfflineLink } from '../offline';
import type { RouteGraphNode } from '../offline';
import { gearChainedHopIntervalMs } from '../car/VehicleDynamics';

export interface UseCruiseModeOptions {
  panorama: google.maps.StreetViewPanorama | null;
  advanceSafe: (dir: 'forward', targetLatLng?: { lat: number; lng: number }, heading?: number) => Promise<void>;
  mapsAuthFailed: boolean;
  heading: number;
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
}

/** Spacing between the extra hops a 2/3 gear queues within one cruise tick. */
export const CRUISE_CHAINED_HOP_INTERVAL_MS = 550;

/** Initial bearing (degrees, 0–360) from point A to point B. */
function bearingBetween(
  from: google.maps.LatLng,
  to: google.maps.LatLng
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(from.lat());
  const lat2 = toRad(to.lat());
  const dLng = toRad(to.lng() - from.lng());
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function useCruiseMode({
  panorama,
  advanceSafe,
  mapsAuthFailed,
  heading,
  isTransitioning,
  setNavPending,
  loadOfflineRouteGraphNodes,
  hopsPerTick,
}: UseCruiseModeOptions) {
  const [isCruiseMode, setIsCruiseMode] = useState(false);
  const offlineNodesRef = useRef<RouteGraphNode[]>([]);

  // Live view heading — tracks head-look every render but is NOT the travel
  // direction. Used only to seed the committed heading when cruise starts.
  const liveHeadingRef = useRef(heading);
  liveHeadingRef.current = heading;

  // Committed travel heading. Frozen against passive head-look so that looking
  // around in free-look/car mode never redirects cruise. Self-corrects to the
  // road after each successful hop via the position-change bearing.
  const cruiseHeadingRef = useRef(heading);

  const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const useTransitionRef = useRef(isTransitioning);
  useTransitionRef.current = isTransitioning;
  const cruiseFailCountRef = useRef(0);
  // A multi-hop tick can outlast the tick interval; this keeps ticks serial.
  const hopInFlightRef = useRef(false);
  const hopsPerTickRef = useRef(hopsPerTick);
  hopsPerTickRef.current = hopsPerTick;

  useEffect(() => {
    if (!isCruiseMode || !panorama || !advanceSafe) {
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
    cruiseHeadingRef.current = liveHeadingRef.current;
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
     * One panorama hop along the committed travel heading. Returns true when
     * the panorama actually changed, and self-corrects the travel heading to
     * the direction we really moved so the next hop follows the road.
     */
    const singleHop = async (): Promise<boolean> => {
      const panoIdBefore = panorama.getPano();
      const posBefore = panorama.getPosition() ?? null;
      // Prefer a known next pano from a prefetched route graph, if we have
      // one for the current location — pre-warms the pano cache so the hop
      // stays smooth even when the live `getLinks()` round trip is slow.
      let targetHint: { lat: number; lng: number } | undefined;
      if (panoIdBefore && offlineNodesRef.current.length > 0) {
        const bestOffline = findBestOfflineLink(offlineNodesRef.current, panoIdBefore, cruiseHeadingRef.current);
        if (bestOffline) targetHint = { lat: bestOffline.lat, lng: bestOffline.lng };
      }
      setNavPending(true);
      try {
        await advanceSafe('forward', targetHint, cruiseHeadingRef.current);
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
        return true;
      }
      return false;
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
      try {
        for (let i = 0; i < hops; i++) {
          // Re-read the gear between chained hops so shifting into P/N (or
          // disengaging cruise) stops the chain instead of finishing it.
          if (i > 0) {
            await new Promise(r => setTimeout(r, gearChainedHopIntervalMs(hops)));
            if (hopsPerTickRef.current && hopsPerTickRef.current() <= 0) break;
          }
          const moved = await singleHop();
          movedAny = movedAny || moved;
          // Dead end: no point spending the remaining hops of this tick.
          if (!moved) break;
        }
      } finally {
        hopInFlightRef.current = false;
      }

      if (movedAny) {
        cruiseFailCountRef.current = 0;
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
    cruiseIntervalRef.current = setInterval(hop, 3000);
    return () => {
      if (cruiseIntervalRef.current) clearInterval(cruiseIntervalRef.current);
      cruiseIntervalRef.current = null;
      hopInFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCruiseMode, panorama, advanceSafe, mapsAuthFailed]);

  return { isCruiseMode, setIsCruiseMode };
}
