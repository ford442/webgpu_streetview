/**
 * src/services/routing/routeAnnouncements.ts
 * Screen-reader announcements for a routed trip: the next maneuver at 200 m
 * and again at 50 m, and arrival. Each (step, threshold) is spoken once; a hop
 * that jumps past both thresholds speaks only the nearer one.
 */

import { nextStep, type TripState } from '../../state/tripStore';
import { formatGuidanceDistance, maneuverInstruction } from './guidanceFormat';

export const ANNOUNCE_THRESHOLDS_M = [200, 50] as const;

export class RouteAnnouncer {
  private readonly announce: (message: string) => void;
  private spoken = new Set<string>();
  private lastRouteId: string | null = null;
  private lastStatus: TripState['status'] = 'idle';

  constructor(announce: (message: string) => void) {
    this.announce = announce;
  }

  update(state: TripState): void {
    const routeId = state.route?.id ?? null;
    if (routeId !== this.lastRouteId || (state.status === 'driving' && this.lastStatus !== 'driving')) {
      this.spoken.clear();
      this.lastRouteId = routeId;
    }
    const prevStatus = this.lastStatus;
    this.lastStatus = state.status;

    if (state.status === 'arrived' && prevStatus === 'driving') {
      this.announce('You have arrived at your destination.');
      return;
    }
    if (state.status !== 'driving' || !state.progress) return;
    const step = nextStep(state);
    if (!step) return;
    const dist = state.progress.distanceToNextStepM;
    const crossed = ANNOUNCE_THRESHOLDS_M.filter((t) => dist <= t);
    if (crossed.length === 0) return;
    const key = (t: number): string => `${state.progress!.nextStepIndex}@${t}`;
    const nearest = crossed[crossed.length - 1]!;
    if (this.spoken.has(key(nearest))) return;
    for (const t of crossed) this.spoken.add(key(t));
    const instruction = maneuverInstruction(step.maneuver, step.name, step.exit);
    this.announce(`In ${formatGuidanceDistance(dist)}, ${instruction.charAt(0).toLowerCase()}${instruction.slice(1)}.`);
  }
}
