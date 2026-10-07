/**
 * src/services/maps/callBudget.ts
 * Session call meter: the one place that counts (and, per kind, caps) the
 * network lookups this app makes on the user's behalf.
 *
 *   panorama     StreetViewService.getPanorama — teleport prefetch, the
 *                historical ring crawl, route-prefetch link collection, the
 *                route-following re-snap, globe/pano-location lookups.
 *   placeSearch  Places / Geocoding / coverage lookups. Counted here; capped
 *                by its own family budget (`search/placeSearchBudget.ts`,
 *                which keeps error backoff and the nearby throttle).
 *   directions   Google DirectionsService. No provider uses it by default; the
 *                cap is 0 until BILLING_SAFETY_CHECKLIST.md says otherwise.
 *   routing      Non-Google route requests (OSRM-compatible endpoint). Not a
 *                Maps call, but a shared demo server asks for low volume.
 *
 * Exposed on `window.__STREETVIEW_PROBE__.getCallBudget()`.
 */

export type MapsCallKind = 'panorama' | 'placeSearch' | 'directions' | 'routing';

/** `null` = counted here, capped by the kind's own family budget. */
export const MAPS_CALL_BUDGET_CAPS: Readonly<Record<MapsCallKind, number | null>> = {
  // A runaway guard, not a pace limit: a teleport prefetch is one call, a
  // historical crawl twelve, a re-snap one. Route following on-route makes none.
  panorama: 2000,
  placeSearch: null,
  directions: 0,
  routing: 40,
};

export interface MapsCallKindStats {
  used: number;
  cap: number | null;
  remaining: number | null;
  blocked: number;
}

export interface MapsCallBudgetStats {
  total: number;
  byKind: Record<MapsCallKind, MapsCallKindStats>;
  /** Calls per call site (`'teleport-prefetch'`, `'route-resnap'`, …). */
  bySource: Record<string, number>;
}

const KINDS: readonly MapsCallKind[] = ['panorama', 'placeSearch', 'directions', 'routing'];

export class MapsCallBudget {
  private readonly caps: Record<MapsCallKind, number | null>;
  private readonly used: Record<MapsCallKind, number> = { panorama: 0, placeSearch: 0, directions: 0, routing: 0 };
  private readonly blocked: Record<MapsCallKind, number> = { panorama: 0, placeSearch: 0, directions: 0, routing: 0 };
  private readonly bySource = new Map<string, number>();

  constructor(caps?: Partial<Record<MapsCallKind, number | null>>) {
    this.caps = { ...MAPS_CALL_BUDGET_CAPS, ...caps };
  }

  /** Would one more call of this kind fit? Counts a refusal as blocked. */
  allow(kind: MapsCallKind): boolean {
    const cap = this.caps[kind];
    if (cap !== null && this.used[kind] >= cap) {
      this.blocked[kind] += 1;
      return false;
    }
    return true;
  }

  /** Count a call that was (or is about to be) made. */
  record(kind: MapsCallKind, source: string): void {
    this.used[kind] += 1;
    this.bySource.set(source, (this.bySource.get(source) ?? 0) + 1);
  }

  /** `allow` + `record` in one step; false means do not make the call. */
  tryConsume(kind: MapsCallKind, source: string): boolean {
    if (!this.allow(kind)) return false;
    this.record(kind, source);
    return true;
  }

  getStats(): MapsCallBudgetStats {
    const byKind = {} as Record<MapsCallKind, MapsCallKindStats>;
    let total = 0;
    for (const kind of KINDS) {
      const cap = this.caps[kind];
      total += this.used[kind];
      byKind[kind] = {
        used: this.used[kind],
        cap,
        remaining: cap === null ? null : Math.max(0, cap - this.used[kind]),
        blocked: this.blocked[kind],
      };
    }
    return { total, byKind, bySource: Object.fromEntries(this.bySource) };
  }
}

let sessionBudget: MapsCallBudget | null = null;

export function getMapsCallBudget(): MapsCallBudget {
  if (!sessionBudget) sessionBudget = new MapsCallBudget();
  return sessionBudget;
}

/** Test-only: replace the process-wide meter. */
export function resetMapsCallBudgetForTests(budget?: MapsCallBudget): void {
  sessionBudget = budget ?? new MapsCallBudget();
}

/** Thrown (or rejected with) when the meter refuses a call. */
export class CallBudgetExceededError extends Error {
  readonly kind: MapsCallKind;

  constructor(kind: MapsCallKind, source: string) {
    super(`Session call budget for ${kind} is exhausted (${source})`);
    this.name = 'CallBudgetExceededError';
    this.kind = kind;
  }
}
