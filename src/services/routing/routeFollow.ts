/**
 * src/services/routing/routeFollow.ts
 * Route-following cruise, as pure decisions (no Maps calls, no React).
 *
 * At each hop: project the current pano onto the route, look a little way
 * ahead along it, and aim at the Street View link whose heading tracks that
 * point. The link choice is the *only* thing that changes versus greedy
 * cruise, so on-route following costs zero extra API calls — the hop is still
 * `getLinks()` + `setPano()`.
 *
 * Off-route (cross-track beyond the threshold, or no link anywhere near the
 * route's direction, for N hops in a row) the follower asks for one re-snap to
 * a route point ahead; the caller makes that single metered `getPanorama` and
 * teleports through the hold-pause path.
 */

import { absoluteAngleDiff } from '../../utils/navigation';
import type { LatLng } from './RouteProvider';
import {
  bearingBetween,
  distanceBetween,
  pointAlong,
  projectOnRoute,
  type ActiveRoute,
  type RouteProjection,
} from './routeGeometry';
import type { TripProgress } from '../../state/tripStore';

export interface RouteFollowConfig {
  /**
   * How far ahead along the route to aim. About one pano spacing: far enough
   * that the pano just before a junction already aims into the turn, short
   * enough that a straight road is not cut diagonally.
   */
  lookaheadM: number;
  /** Cross-track distance that counts as off the route. */
  offRouteCrossM: number;
  /** Consecutive off-route hops before a re-snap is requested. */
  offRouteStrikes: number;
  /** A link further than this from the route's direction is "no link this way". */
  maxLinkDeviationDeg: number;
  /** Arrival radius around the destination / remaining distance. */
  arrivalM: number;
  /** Re-snap lands this far ahead of the current progress. */
  resnapAheadM: number;
  /** Smoothing for the measured pace (EMA weight of the newest sample). */
  paceSmoothing: number;
}

export const ROUTE_FOLLOW_DEFAULTS: RouteFollowConfig = {
  lookaheadM: 12,
  offRouteCrossM: 40,
  offRouteStrikes: 2,
  maxLinkDeviationDeg: 100,
  arrivalM: 20,
  resnapAheadM: 20,
  paceSmoothing: 0.3,
};

export interface LinkLike {
  heading?: number | null;
  pano?: string | null;
}

export type RouteHopDecision =
  | { kind: 'follow'; heading: number; targetBearing: number }
  | { kind: 'resnap'; target: LatLng; reason: 'cross-track' | 'no-link' }
  | { kind: 'arrived' };

export class RouteFollower {
  readonly route: ActiveRoute;
  private readonly config: RouteFollowConfig;
  private readonly now: () => number;
  private lastAlongM: number | null = null;
  private lastProjection: RouteProjection | null = null;
  private strikes = 0;
  private paceMps: number | null = null;
  private lastSample: { alongM: number; at: number } | null = null;

  constructor(route: ActiveRoute, config: Partial<RouteFollowConfig> = {}, now: () => number = () => Date.now()) {
    this.route = route;
    this.config = { ...ROUTE_FOLLOW_DEFAULTS, ...config };
    this.now = now;
  }

  /**
   * Record where the car is (after a hop, a re-snap, or at the start) and
   * return the progress that follows from it. Pace is measured only from
   * forward progress between consecutive samples.
   */
  notePosition(pos: LatLng): TripProgress {
    const proj = projectOnRoute(this.route, pos, this.lastAlongM);
    const at = this.now();
    if (this.lastSample && proj.alongM > this.lastSample.alongM) {
      const dt = (at - this.lastSample.at) / 1000;
      if (dt > 0.2) {
        const sample = (proj.alongM - this.lastSample.alongM) / dt;
        this.paceMps = this.paceMps === null
          ? sample
          : this.paceMps + this.config.paceSmoothing * (sample - this.paceMps);
      }
    }
    this.lastSample = { alongM: proj.alongM, at };
    this.lastAlongM = proj.alongM;
    this.lastProjection = proj;
    return this.progressFor(proj);
  }

  /** Forget the pace sample after a teleport so the jump is not counted as speed. */
  noteResnap(pos: LatLng): TripProgress {
    this.lastSample = null;
    this.strikes = 0;
    return this.notePosition(pos);
  }

  hasArrived(pos: LatLng, proj: RouteProjection = this.lastProjection ?? projectOnRoute(this.route, pos, this.lastAlongM)): boolean {
    const destination = this.route.polyline[this.route.polyline.length - 1]!;
    return (
      this.route.lengthM - proj.alongM <= this.config.arrivalM
      || distanceBetween(pos, destination) <= this.config.arrivalM
    );
  }

  /** Decide the next hop from the current pano's position and links. */
  planHop(pos: LatLng, links: readonly LinkLike[]): RouteHopDecision {
    const proj = projectOnRoute(this.route, pos, this.lastAlongM);
    this.lastAlongM = proj.alongM;
    this.lastProjection = proj;
    if (this.hasArrived(pos, proj)) return { kind: 'arrived' };

    const target = pointAlong(this.route, proj.alongM + this.config.lookaheadM);
    const targetBearing = bearingBetween(pos, target);

    let best: LinkLike | null = null;
    let bestDiff = Infinity;
    for (const link of links) {
      if (link.heading == null) continue;
      const diff = absoluteAngleDiff(targetBearing, link.heading);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = link;
      }
    }

    const offCross = Math.abs(proj.crossM) > this.config.offRouteCrossM;
    const noLink = !best || bestDiff > this.config.maxLinkDeviationDeg;
    if (offCross || noLink) {
      this.strikes += 1;
      if (this.strikes >= this.config.offRouteStrikes) {
        this.strikes = 0;
        return {
          kind: 'resnap',
          target: pointAlong(this.route, proj.alongM + this.config.resnapAheadM),
          reason: offCross ? 'cross-track' : 'no-link',
        };
      }
    } else {
      this.strikes = 0;
    }
    // Still hop on the best link available: one bad pano should not stall the trip.
    return { kind: 'follow', heading: best?.heading ?? targetBearing, targetBearing };
  }

  /** Route bearing at the current progress — what the car body eases toward. */
  routeBearingAhead(pos: LatLng): number {
    const along = this.lastAlongM ?? 0;
    return bearingBetween(pos, pointAlong(this.route, along + this.config.lookaheadM * 2));
  }

  progressFor(proj: RouteProjection): TripProgress {
    const { steps } = this.route;
    let next = steps.length - 1;
    for (let i = 0; i < steps.length; i++) {
      // A maneuver within 5 m behind us still counts as "now".
      if (steps[i]!.alongM > proj.alongM - 5 && steps[i]!.maneuver !== 'depart') {
        next = i;
        break;
      }
    }
    const remainingM = Math.max(0, this.route.lengthM - proj.alongM);
    return {
      alongM: proj.alongM,
      crossM: proj.crossM,
      remainingM,
      nextStepIndex: Math.max(0, next),
      distanceToNextStepM: Math.max(0, (steps[next]?.alongM ?? this.route.lengthM) - proj.alongM),
      etaS: this.paceMps && this.paceMps > 0.05 ? remainingM / this.paceMps : null,
      avgSpeedMps: this.paceMps,
    };
  }
}
