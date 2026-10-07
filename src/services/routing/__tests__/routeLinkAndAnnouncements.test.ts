import { createTripStore } from '../../../state/tripStore';
import { formatEta, formatGuidanceDistance, maneuverInstruction } from '../guidanceFormat';
import { RouteAnnouncer } from '../routeAnnouncements';
import { RouteFollower } from '../routeFollow';
import { buildActiveRoute } from '../routeGeometry';
import {
  buildRouteLinkUrl,
  decodeRouteStops,
  encodeRouteStops,
  parseLatLngText,
  readRouteLink,
} from '../routeLink';
import { DESTINATION, L_ROUTE, ORIGIN, buildGraph } from './routeFixtures';

describe('?route= links', () => {
  it('round-trips stops at 5 decimals and labels them', () => {
    const raw = encodeRouteStops([{ lat: 55.953312, lng: -3.188301 }, { lat: 56.6826, lng: -5.1023 }]);
    expect(raw).toBe('55.95331,-3.18830;56.68260,-5.10230');
    expect(decodeRouteStops(raw)).toEqual([
      { lat: 55.95331, lng: -3.1883, label: 'Start' },
      { lat: 56.6826, lng: -5.1023, label: 'Destination' },
    ]);
    expect(readRouteLink(`?look=noir&route=${encodeURIComponent(raw)}`)).toHaveLength(2);
  });

  it('rejects anything that is not 2…25 valid points', () => {
    expect(decodeRouteStops('55.9,-3.1')).toBeNull();
    expect(decodeRouteStops('55.9,-3.1;95,0')).toBeNull();
    expect(decodeRouteStops('55.9,-3.1;abc,1')).toBeNull();
    expect(decodeRouteStops('55.9,-3.1;1,2,3')).toBeNull();
    expect(decodeRouteStops('55.9,-3.1;,2')).toBeNull();
    expect(decodeRouteStops(Array.from({ length: 26 }, () => '1,1').join(';'))).toBeNull();
    expect(readRouteLink('?lat=1&lng=2')).toBeNull();
  });

  it('builds a share URL that keeps the other params', () => {
    const url = buildRouteLinkUrl([ORIGIN, DESTINATION], 'https://test.1ink.us/streetview/?look=noir');
    expect(url).toMatch(/^https:\/\/test\.1ink\.us\/streetview\/\?look=noir&route=55\.95000%2C-3\.20000%3B/);
    expect(readRouteLink(new URL(url).search)).toHaveLength(2);
  });

  it('parses typed "lat, lng" stops', () => {
    expect(parseLatLngText(' 55.9533, -3.1883 ')).toEqual({ lat: 55.9533, lng: -3.1883 });
    expect(parseLatLngText('55.9533 -3.1883')).toEqual({ lat: 55.9533, lng: -3.1883 });
    expect(parseLatLngText('Glencoe')).toBeNull();
    expect(parseLatLngText('91, 0')).toBeNull();
  });
});

describe('guidance text', () => {
  it('rounds distances like a nav screen', () => {
    expect(formatGuidanceDistance(47)).toBe('45 m');
    expect(formatGuidanceDistance(213)).toBe('210 m');
    expect(formatGuidanceDistance(640)).toBe('650 m');
    expect(formatGuidanceDistance(1449)).toBe('1.4 km');
    expect(formatGuidanceDistance(23400)).toBe('23 km');
    expect(formatGuidanceDistance(Number.NaN)).toBe('—');
  });

  it('formats ETAs', () => {
    expect(formatEta(null)).toBe('—');
    expect(formatEta(42)).toBe('42 s');
    expect(formatEta(12 * 60)).toBe('12 min');
    expect(formatEta(65 * 60)).toBe('1 h 05 min');
  });

  it('phrases instructions', () => {
    expect(maneuverInstruction('turn-right', 'Side Road')).toBe('Turn right onto Side Road');
    expect(maneuverInstruction('continue', '')).toBe('Continue');
    expect(maneuverInstruction('roundabout', 'A82', 2)).toBe('At the roundabout, take the 2nd exit onto A82');
    expect(maneuverInstruction('arrive', 'Side Road')).toBe('Arrive at destination');
  });
});

describe('RouteAnnouncer', () => {
  it('speaks the next maneuver at 200 m and 50 m, once each, then arrival', () => {
    const route = buildActiveRoute(L_ROUTE, { stops: [ORIGIN, DESTINATION], providerId: 'test' });
    const graph = buildGraph();
    const store = createTripStore({ status: 'driving', route });
    const follower = new RouteFollower(route);
    const spoken: string[] = [];
    const announcer = new RouteAnnouncer((m) => spoken.push(m));
    store.subscribe(() => announcer.update(store.get()));
    for (let i = 0; i <= 30; i++) store.update({ progress: follower.notePosition(graph.get(`m${i}`)!.pos) });
    expect(spoken).toEqual([
      'In 190 m, turn right onto Side Road.', // first hop inside 200 m
      'In 40 m, turn right onto Side Road.', // first hop inside 50 m
    ]);
    store.update({ status: 'arrived' });
    expect(spoken[spoken.length - 1]).toBe('You have arrived at your destination.');
  });

  it('a hop that jumps past both thresholds speaks only the nearer one', () => {
    const route = buildActiveRoute(L_ROUTE, { stops: [ORIGIN, DESTINATION], providerId: 'test' });
    const graph = buildGraph();
    const store = createTripStore({ status: 'driving', route });
    const follower = new RouteFollower(route);
    const spoken: string[] = [];
    const announcer = new RouteAnnouncer((m) => spoken.push(m));
    store.subscribe(() => announcer.update(store.get()));
    store.update({ progress: follower.notePosition(graph.get('m0')!.pos) });
    store.update({ progress: follower.notePosition(graph.get('m27')!.pos) });
    expect(spoken).toEqual(['In 30 m, turn right onto Side Road.']);
  });
});

describe('route export', () => {
  it('writes the routed polyline as a GPX track with the stops as waypoints', async () => {
    const { routeToGpx } = await import('../routeExport');
    const gpx = routeToGpx(L_ROUTE, [{ ...ORIGIN, label: 'Start & go' }, { ...DESTINATION, label: 'End' }], 'Trip <1>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<name>Trip &lt;1&gt;</name>');
    expect(gpx).toContain('<wpt lat="55.950000" lon="-3.200000"><name>Start &amp; go</name></wpt>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(L_ROUTE.polyline.length);
  });

  it('thins a long tour to the provider waypoint limit, keeping both ends', async () => {
    const { tourWaypointsToStops } = await import('../routeExport');
    const wps = Array.from({ length: 100 }, (_, i) => ({ position: { lat: 50 + i * 0.001, lng: 1 } }));
    const stops = tourWaypointsToStops(wps)!;
    expect(stops).toHaveLength(25);
    expect(stops[0]!.lat).toBe(50);
    expect(stops[24]!.lat).toBeCloseTo(50.099, 9);
    expect(tourWaypointsToStops(wps.slice(0, 1))).toBeNull();
  });
});
