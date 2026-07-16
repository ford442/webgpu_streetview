import { useRef, useCallback, useEffect } from 'react';

const WAYPOINT_INTERVAL_MS = 5000;

export interface UseAutopilotOptions {
  teleportSafe: (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => Promise<void>;
  handleGlobeTeleport: (lat: number, lng: number) => Promise<void>;
  panoCache: { fetch: (lat: number, lng: number) => Promise<any> };
  isTransitioning: boolean;
  setNavPending: (pending: boolean) => void;
}

export function useAutopilot({
  teleportSafe,
  handleGlobeTeleport,
  panoCache,
  isTransitioning,
  setNavPending,
}: UseAutopilotOptions) {
  const autopilotRef = useRef<NodeJS.Timeout | null>(null);
  const autopilotTransitionRef = useRef(isTransitioning);
  autopilotTransitionRef.current = isTransitioning;

  const handleStartJourney = useCallback(async (waypoints: { lat: number; lng: number }[]) => {
    if (waypoints.length === 0) return;

    waypoints.forEach(wp => panoCache.fetch(wp.lat, wp.lng).catch(() => {}));

    await handleGlobeTeleport(waypoints[0]!.lat, waypoints[0]!.lng);

    if (waypoints.length > 1) {
      let idx = 1;
      autopilotRef.current = setInterval(async () => {
        if (idx >= waypoints.length) {
          if (autopilotRef.current) clearInterval(autopilotRef.current);
          autopilotRef.current = null;
          return;
        }
        if (autopilotTransitionRef.current) {
          console.log('[Autopilot] Waiting for transition pause before next waypoint');
          return;
        }
        const wp = waypoints[idx]!;
        setNavPending(true);
        try {
          await teleportSafe(wp.lat, wp.lng);
        } catch (err) {
          console.warn(`[Autopilot] Failed to teleport to waypoint ${idx}:`, err);
        } finally {
          setNavPending(false);
        }
        idx++;
      }, WAYPOINT_INTERVAL_MS);
    }
  }, [handleGlobeTeleport, panoCache, teleportSafe, setNavPending]);

  useEffect(() => {
    return () => {
      if (autopilotRef.current) clearInterval(autopilotRef.current);
    };
  }, []);

  return { handleStartJourney };
}
