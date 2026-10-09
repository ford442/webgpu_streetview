import { buildOsrmRouteUrl, createOsrmProvider, mapOsrmManeuver, parseOsrmRoute } from './osrmProvider';
import { RouteError, describeRouteError } from './RouteProvider';
import { OSRM_DEMO_ENDPOINT, createConfiguredRouteProvider, resolveRoutingConfig } from './routingConfig';

/** A trimmed real-shape OSRM response: depart, a right turn, arrive. */
function okBody(): unknown {
  return {
    code: 'Ok',
    routes: [{
      distance: 412.5,
      duration: 61.2,
      geometry: { type: 'LineString', coordinates: [[-3.1883, 55.9533], [-3.1869, 55.9541], [-3.1885, 55.9549]] },
      legs: [{
        steps: [
          { distance: 120, name: 'High Street', maneuver: { type: 'depart', location: [-3.1883, 55.9533] } },
          { distance: 5, name: '', maneuver: { type: 'notification', location: [-3.1875, 55.9537] } },
          { distance: 287.5, name: 'Cockburn Street', maneuver: { type: 'turn', modifier: 'right', location: [-3.1869, 55.9541] } },
          { distance: 0, name: 'Cockburn Street', maneuver: { type: 'arrive', location: [-3.1885, 55.9549] } },
        ],
      }],
    }],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const WAYPOINTS = [{ lat: 55.9533, lng: -3.1883 }, { lat: 55.9549, lng: -3.1885 }];
const signal = (): AbortSignal => new AbortController().signal;

describe('buildOsrmRouteUrl', () => {
  it('orders coordinates lng,lat and asks for steps + full GeoJSON geometry', () => {
    expect(buildOsrmRouteUrl('https://osrm.example/', WAYPOINTS)).toBe(
      'https://osrm.example/route/v1/driving/-3.188300,55.953300;-3.188500,55.954900'
      + '?steps=true&geometries=geojson&overview=full',
    );
  });
});

describe('mapOsrmManeuver', () => {
  it.each([
    [{ type: 'depart' }, 'depart'],
    [{ type: 'turn', modifier: 'left' }, 'turn-left'],
    [{ type: 'turn', modifier: 'sharp right' }, 'sharp-right'],
    [{ type: 'end of road', modifier: 'slight left' }, 'slight-left'],
    [{ type: 'new name', modifier: 'straight' }, 'continue'],
    [{ type: 'continue', modifier: 'uturn' }, 'uturn'],
    [{ type: 'fork', modifier: 'slight left' }, 'fork-left'],
    [{ type: 'fork', modifier: 'right' }, 'fork-right'],
    [{ type: 'rotary' }, 'roundabout'],
    [{ type: 'merge', modifier: 'left' }, 'merge'],
    [{ type: 'arrive' }, 'arrive'],
    [{ type: 'notification' }, null],
    [{ type: 'exit roundabout' }, null],
  ] as const)('%j → %s', (m, expected) => {
    expect(mapOsrmManeuver(m)).toBe(expected);
  });
});

describe('parseOsrmRoute', () => {
  it('reads geometry, totals and steps; folds non-decision steps into the previous one', () => {
    const route = parseOsrmRoute(okBody());
    expect(route.polyline).toEqual([
      { lat: 55.9533, lng: -3.1883 }, { lat: 55.9541, lng: -3.1869 }, { lat: 55.9549, lng: -3.1885 },
    ]);
    expect(route.distanceM).toBe(412.5);
    expect(route.durationS).toBe(61.2);
    expect(route.steps.map((s) => s.maneuver)).toEqual(['depart', 'turn-right', 'arrive']);
    expect(route.steps[0]!.distanceM).toBe(125); // 120 + the folded notification
    expect(route.steps[1]!.name).toBe('Cockburn Street');
  });

  it('turns via-point arrive/depart pairs into one continue', () => {
    const body = okBody() as { routes: { legs: unknown[] }[] };
    body.routes[0]!.legs = [
      { steps: [
        { distance: 100, name: 'A', maneuver: { type: 'depart', location: [-3.1883, 55.9533] } },
        { distance: 0, name: 'A', maneuver: { type: 'arrive', location: [-3.1869, 55.9541] } },
      ] },
      { steps: [
        { distance: 50, name: 'B', maneuver: { type: 'depart', location: [-3.1869, 55.9541] } },
        { distance: 0, name: 'B', maneuver: { type: 'arrive', location: [-3.1885, 55.9549] } },
      ] },
    ];
    const route = parseOsrmRoute(body);
    expect(route.steps.map((s) => s.maneuver)).toEqual(['depart', 'continue', 'arrive']);
    expect(route.steps[1]!.distanceM).toBe(50);
  });

  it('reports NoRoute honestly and rejects malformed bodies', () => {
    expect(() => parseOsrmRoute({ code: 'NoRoute', message: 'Impossible route' }))
      .toThrow(expect.objectContaining({ kind: 'no-route' }));
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [] })).toThrow(expect.objectContaining({ kind: 'no-route' }));
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: 'x' } }] }))
      .toThrow(expect.objectContaining({ kind: 'bad-response' }));
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[0, 99], [1, 1]] } }] }))
      .toThrow(expect.objectContaining({ kind: 'bad-response' }));
    expect(() => parseOsrmRoute(null)).toThrow(RouteError);
  });
});

describe('createOsrmProvider', () => {
  it('fetches and parses a route', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const provider = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl });
    const route = await provider.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal());
    expect(provider.billable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(route.steps).toHaveLength(3);
  });

  it('never fakes a route: network, HTTP and NoRoute failures each have a kind', async () => {
    const down = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(down.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal()))
      .rejects.toMatchObject({ kind: 'network' });

    const busy = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl: async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' }) });
    await expect(busy.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal()))
      .rejects.toMatchObject({ kind: 'http', message: '429 Too Many Requests' });

    const nowhere = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl: async () => jsonResponse({ code: 'NoRoute', message: 'Impossible route' }, 400) });
    await expect(nowhere.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal()))
      .rejects.toMatchObject({ kind: 'no-route' });
  });

  it('times out instead of hanging, and honours an external abort', async () => {
    vi.useFakeTimers();
    try {
      const hang = (_url: unknown, init?: RequestInit): Promise<Response> => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      const provider = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl: hang as typeof fetch, timeoutMs: 1000 });
      const pending = provider.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal());
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'network' });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;

      const ctl = new AbortController();
      const cancelled = provider.route({ waypoints: WAYPOINTS, profile: 'driving' }, ctl.signal);
      const cancelAssertion = expect(cancelled).rejects.toMatchObject({ kind: 'aborted' });
      ctl.abort();
      await cancelAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates the request before any network call', async () => {
    const fetchImpl = vi.fn();
    const provider = createOsrmProvider({ endpoint: 'https://osrm.example', fetchImpl });
    await expect(provider.route({ waypoints: [WAYPOINTS[0]!], profile: 'driving' }, signal()))
      .rejects.toMatchObject({ kind: 'invalid-request' });
    await expect(provider.route({ waypoints: [WAYPOINTS[0]!, { lat: Number.NaN, lng: 0 }], profile: 'driving' }, signal()))
      .rejects.toMatchObject({ kind: 'invalid-request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('routing config', () => {
  it('defaults to the demo server, honours an endpoint, and "" switches routing off', () => {
    expect(resolveRoutingConfig(undefined)).toEqual({ endpoint: OSRM_DEMO_ENDPOINT, usingDemo: true });
    expect(resolveRoutingConfig('https://osrm.example/')).toEqual({ endpoint: 'https://osrm.example', usingDemo: false });
    expect(resolveRoutingConfig('')).toEqual({ endpoint: null, usingDemo: false });
    expect(resolveRoutingConfig('javascript:alert(1)')).toEqual({ endpoint: null, usingDemo: false });
    expect(resolveRoutingConfig('not a url')).toEqual({ endpoint: null, usingDemo: false });
  });

  it('an unconfigured deployment reports "unconfigured", not a fake route', async () => {
    const provider = createConfiguredRouteProvider({ endpoint: null, usingDemo: false });
    const err = await provider.route({ waypoints: WAYPOINTS, profile: 'driving' }, signal()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'unconfigured' });
    expect(describeRouteError(err)).toMatch(/not configured/);
  });
});
