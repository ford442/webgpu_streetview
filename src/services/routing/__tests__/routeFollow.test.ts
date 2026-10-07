import { absoluteAngleDiff } from '../../../utils/navigation';
import { RouteFollower } from '../routeFollow';
import {
  ROUTE_RESAMPLE_STEP_M,
  buildActiveRoute,
  pointAlong,
  projectOnRoute,
  resampledWaypoints,
} from '../routeGeometry';
import { CORNER, DESTINATION, L_ROUTE, ORIGIN, buildGraph, linksOf } from './routeFixtures';

const route = () => buildActiveRoute(L_ROUTE, { stops: [ORIGIN, DESTINATION], providerId: 'test' });

describe('buildActiveRoute', () => {
  it('measures the route, resamples it and places each step along it', () => {
    const r = route();
    expect(r.lengthM).toBeCloseTo(500, 0);
    expect(r.cumulativeM[r.cumulativeM.length - 1]).toBeCloseTo(r.lengthM, 6);
    expect(r.resampled.length / 2).toBe(Math.ceil(r.lengthM / ROUTE_RESAMPLE_STEP_M) + 1);
    expect(r.steps.map((s) => Math.round(s.alongM))).toEqual([0, 300, 500]);
    expect(r.id).toMatch(/^route:55\.95000,-3\.20000;/);
  });

  it('projects with a hint and stays monotone on the near leg', () => {
    const r = route();
    const mid = projectOnRoute(r, { lat: CORNER.lat, lng: CORNER.lng - 0.0005 });
    expect(mid.alongM).toBeGreaterThan(260);
    expect(mid.alongM).toBeLessThan(275);
    const corner = pointAlong(r, 300);
    expect(projectOnRoute(r, corner, 290).alongM).toBeCloseTo(300, 0);
  });

  it('thins the resample into prefetch waypoints that keep both ends', () => {
    const wps = resampledWaypoints(route(), 50);
    expect(wps[0]).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(wps[wps.length - 1]!.lat).toBeCloseTo(DESTINATION.lat, 9);
    expect(wps).toHaveLength(11);
  });
});

describe('RouteFollower on a synthetic Street View graph', () => {
  it('turns right at the corner instead of carrying straight on, and arrives', () => {
    const graph = buildGraph();
    let t = 0;
    const follower = new RouteFollower(route(), {}, () => t);
    let at = 'm0';
    const visited: string[] = [at];
    follower.notePosition(graph.get(at)!.pos);
    for (let hop = 0; hop < 80; hop++) {
      const pano = graph.get(at)!;
      const decision = follower.planHop(pano.pos, linksOf(graph, at));
      if (decision.kind === 'arrived') break;
      expect(decision.kind).toBe('follow');
      if (decision.kind !== 'follow') return;
      const next = linksOf(graph, at).find((l) => absoluteAngleDiff(l.heading, decision.heading) < 1e-9)!;
      at = next.pano;
      visited.push(at);
      t += 3000;
      follower.notePosition(graph.get(at)!.pos);
    }
    expect(visited).toContain('m30');
    expect(visited).toContain('s1');
    expect(visited).not.toContain('m31');
    expect(visited[visited.length - 1]).toMatch(/^s(18|19|20)$/);
    expect(follower.hasArrived(graph.get(at)!.pos)).toBe(true);
  });

  it('reports progress, the next maneuver and a pace-based ETA', () => {
    const graph = buildGraph();
    let t = 0;
    const follower = new RouteFollower(route(), {}, () => t);
    follower.notePosition(graph.get('m10')!.pos);
    t += 3000;
    const p = follower.notePosition(graph.get('m11')!.pos);
    expect(p.alongM).toBeCloseTo(110, 0);
    expect(Math.abs(p.crossM)).toBeCloseTo(3, 0);
    expect(p.nextStepIndex).toBe(1);
    expect(p.distanceToNextStepM).toBeCloseTo(190, 0);
    expect(p.avgSpeedMps).toBeCloseTo(10 / 3, 1);
    expect(p.etaS).toBeCloseTo(390 / (10 / 3), -1);
  });

  it('asks for one re-snap ahead after two off-route hops', () => {
    const graph = buildGraph();
    const follower = new RouteFollower(route());
    follower.notePosition(graph.get('m10')!.pos);
    // A pano 80 m north of the route with links that do follow its direction.
    const lost = { lat: graph.get('m12')!.pos.lat + 0.00072, lng: graph.get('m12')!.pos.lng };
    const links = [{ heading: 90, pano: 'x' }, { heading: 270, pano: 'y' }];
    expect(follower.planHop(lost, links).kind).toBe('follow');
    const second = follower.planHop(lost, links);
    expect(second.kind).toBe('resnap');
    if (second.kind !== 'resnap') return;
    expect(second.reason).toBe('cross-track');
    expect(projectOnRoute(route(), second.target).alongM).toBeGreaterThan(125);
    // The strike count resets after a re-snap request.
    expect(follower.planHop(lost, links).kind).toBe('follow');
  });

  it('treats a pano whose links all point away from the route as off-route', () => {
    const graph = buildGraph();
    const follower = new RouteFollower(route());
    const pos = graph.get('m5')!.pos;
    follower.notePosition(pos);
    const north = [{ heading: 0, pano: 'n' }];
    expect(follower.planHop(pos, north).kind).toBe('follow');
    expect(follower.planHop(pos, north)).toMatchObject({ kind: 'resnap', reason: 'no-link' });
  });
});
