import { useEffect } from 'react';
import { setCarRouteGuidance } from '../../car';
import type { RouteGuidance } from '../../services/routing/guidanceFormat';
import { nextStep, tripStore, type TripState } from '../../state/tripStore';

/** The centre-display view of a trip, or null when no route is being driven. */
export function toRouteGuidance(state: TripState): RouteGuidance | null {
  const { route, progress } = state;
  if (!route || !progress || (state.status !== 'driving' && state.status !== 'arrived')) return null;
  const step = nextStep(state);
  return {
    maneuver: step?.maneuver ?? 'arrive',
    street: step?.name ?? '',
    distanceToNextM: progress.distanceToNextStepM,
    etaS: progress.etaS,
    travelledM: progress.alongM,
    remainingM: progress.remainingM,
    totalM: route.lengthM,
    avgSpeedKmh: progress.avgSpeedMps === null ? null : progress.avgSpeedMps * 3.6,
    arrived: state.status === 'arrived',
    exit: step?.exit,
  };
}

/** Keep the cabin centre display in step with the routed trip. */
export function useCabinRouteGuidance(): void {
  useEffect(() => {
    const push = (): void => setCarRouteGuidance(toRouteGuidance(tripStore.get()));
    push();
    const unsubscribe = tripStore.subscribe(push);
    return () => {
      unsubscribe();
      setCarRouteGuidance(null);
    };
  }, []);
}
