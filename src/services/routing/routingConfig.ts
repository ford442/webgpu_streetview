/**
 * src/services/routing/routingConfig.ts
 * Where routes come from, resolved at runtime from `public/config.js`
 * (`window.ROUTING_ENDPOINT`), like the Maps key.
 *
 *   unset            → the public OSRM demo server (development / low volume)
 *   ''               → routing is off; the planner says so instead of failing
 *   'https://…'      → that OSRM-compatible endpoint
 *
 * Nothing in this chain bills: a Google Directions provider would be opt-in,
 * metered and documented in BILLING_SAFETY_CHECKLIST.md before it could be
 * selected here.
 */

import { createOsrmProvider } from './osrmProvider';
import { RouteError, type RouteProvider } from './RouteProvider';

/**
 * Public OSRM demo. Its usage policy allows light, non-commercial use only
 * (≈1 request/s, no bulk); this app makes one request per planned trip.
 */
export const OSRM_DEMO_ENDPOINT = 'https://router.project-osrm.org';

export interface RoutingConfig {
  endpoint: string | null;
  /** True when no deployment endpoint is set and the demo server is used. */
  usingDemo: boolean;
}

export function resolveRoutingConfig(
  raw: unknown = typeof window !== 'undefined' ? window.ROUTING_ENDPOINT : undefined,
): RoutingConfig {
  if (raw === undefined || raw === null) return { endpoint: OSRM_DEMO_ENDPOINT, usingDemo: true };
  if (typeof raw !== 'string') return { endpoint: null, usingDemo: false };
  const trimmed = raw.trim();
  if (trimmed === '') return { endpoint: null, usingDemo: false };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { endpoint: null, usingDemo: false };
  } catch {
    return { endpoint: null, usingDemo: false };
  }
  return { endpoint: trimmed.replace(/\/+$/, ''), usingDemo: trimmed.replace(/\/+$/, '') === OSRM_DEMO_ENDPOINT };
}

/** A provider that always reports routing as switched off. */
const UNCONFIGURED_PROVIDER: RouteProvider = {
  id: 'unconfigured',
  billable: false,
  route: () => Promise.reject(new RouteError('unconfigured', 'no routing endpoint')),
};

export function createConfiguredRouteProvider(config: RoutingConfig = resolveRoutingConfig()): RouteProvider {
  return config.endpoint ? createOsrmProvider({ endpoint: config.endpoint }) : UNCONFIGURED_PROVIDER;
}
