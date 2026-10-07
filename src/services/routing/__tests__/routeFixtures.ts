/**
 * A tiny synthetic Street View graph around an L-shaped route, for the route
 * follower and cruise tests: east 300 m along "Main Street", right at the
 * corner, south 200 m down "Side Road". Main Street carries on east past the
 * corner, so a follower that ignores the route goes straight on.
 */
import { JS_FALLBACK } from '../../../wasm/jsFallback';
import type { LatLng, Route } from '../RouteProvider';

export const ORIGIN: LatLng = { lat: 55.95, lng: -3.2 };
const offset = (p: LatLng, metres: number, bearing: number): LatLng =>
  JS_FALLBACK.offsetLatLng(p.lat, p.lng, metres, bearing);

export const CORNER = offset(ORIGIN, 300, 90);
export const DESTINATION = offset(CORNER, 200, 180);

export const L_ROUTE: Route = {
  polyline: [ORIGIN, offset(ORIGIN, 150, 90), CORNER, offset(CORNER, 100, 180), DESTINATION],
  distanceM: 500,
  durationS: 60,
  steps: [
    { maneuver: 'depart', name: 'Main Street', location: ORIGIN, distanceM: 300 },
    { maneuver: 'turn-right', name: 'Side Road', location: CORNER, distanceM: 200 },
    { maneuver: 'arrive', name: 'Side Road', location: DESTINATION, distanceM: 0 },
  ],
};

export interface FakePano {
  id: string;
  pos: LatLng;
  links: string[];
}

/**
 * Panos every 10 m, 3 m left of the centreline (cameras are not on the road
 * axis). Main Street runs from 50 m before the origin to 100 m past the corner.
 */
export function buildGraph(): Map<string, FakePano> {
  const graph = new Map<string, FakePano>();
  const add = (id: string, pos: LatLng): void => {
    graph.set(id, { id, pos, links: [] });
  };
  const link = (a: string, b: string): void => {
    graph.get(a)!.links.push(b);
    graph.get(b)!.links.push(a);
  };
  for (let i = -5; i <= 40; i++) add(`m${i}`, offset(offset(ORIGIN, i * 10, 90), 3, 0));
  for (let i = -5; i < 40; i++) link(`m${i}`, `m${i + 1}`);
  for (let j = 1; j <= 20; j++) add(`s${j}`, offset(offset(CORNER, j * 10, 180), 3, 90));
  link('m30', 's1');
  for (let j = 1; j < 20; j++) link(`s${j}`, `s${j + 1}`);
  return graph;
}

export function linksOf(graph: Map<string, FakePano>, id: string): { pano: string; heading: number }[] {
  const from = graph.get(id)!;
  return from.links.map((to) => {
    const p = graph.get(to)!.pos;
    return { pano: to, heading: JS_FALLBACK.initialBearing(from.pos.lat, from.pos.lng, p.lat, p.lng) };
  });
}
