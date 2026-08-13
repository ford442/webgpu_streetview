/**
 * Session budget + kill switch for Places Autocomplete, Nearby Search,
 * Geocoding (forward), and optional Street View Static previews.
 *
 * Follows the rear-view feed pattern: off-by-default extras, hard session
 * ceiling, consecutive-error backoff, and a page-lifetime kill switch.
 * See BILLING_SAFETY_CHECKLIST.md.
 */

export type PlaceSearchMeter =
  | 'autocomplete'
  | 'placeDetails'
  | 'nearby'
  | 'geocode'
  | 'staticPreview'
  | 'streetViewLookup';

export type PlaceSearchBlockReason =
  | 'disabled'
  | 'no-key'
  | 'offline'
  | 'auth-failed'
  | 'budget-exhausted'
  | 'error-backoff'
  | 'killed'
  | 'nearby-off'
  | 'throttled';

export const PLACE_SEARCH_DEFAULTS = {
  /** Debounce before AutocompleteService.getPlacePredictions. */
  autocompleteDebounceMs: 350,
  /** Minimum spacing between Nearby Search network calls. */
  nearbyMinIntervalMs: 4000,
  /** Hard per-session ceiling across all billed meters. */
  maxSessionRequests: 80,
  maxConsecutiveErrors: 5,
  maxNearbyMarkers: 20,
  nearbyRadiusM: 1500,
} as const;

export interface PlaceSearchBudgetStats {
  networkRequests: number;
  byMeter: Record<PlaceSearchMeter, number>;
  blockedSkips: number;
  throttledSkips: number;
  errors: number;
  consecutiveErrors: number;
  budgetRemaining: number;
  killed: boolean;
  nearbyEnabled: boolean;
  lastBlockReason?: PlaceSearchBlockReason;
}

const EMPTY_METERS: Record<PlaceSearchMeter, number> = {
  autocomplete: 0,
  placeDetails: 0,
  nearby: 0,
  geocode: 0,
  staticPreview: 0,
  streetViewLookup: 0,
};

export class PlaceSearchBudget {
  private networkRequests = 0;
  private byMeter: Record<PlaceSearchMeter, number> = { ...EMPTY_METERS };
  private blockedSkips = 0;
  private throttledSkips = 0;
  private errors = 0;
  private consecutiveErrors = 0;
  private killed = false;
  private nearbyEnabled = false;
  private lastNearbyAt = 0;
  private lastBlockReason: PlaceSearchBlockReason | undefined;
  private readonly maxSessionRequests: number;
  private readonly maxConsecutiveErrors: number;
  private readonly nearbyMinIntervalMs: number;
  private readonly now: () => number;

  constructor(opts?: {
    maxSessionRequests?: number;
    maxConsecutiveErrors?: number;
    nearbyMinIntervalMs?: number;
    now?: () => number;
  }) {
    this.maxSessionRequests = opts?.maxSessionRequests ?? PLACE_SEARCH_DEFAULTS.maxSessionRequests;
    this.maxConsecutiveErrors = opts?.maxConsecutiveErrors ?? PLACE_SEARCH_DEFAULTS.maxConsecutiveErrors;
    this.nearbyMinIntervalMs = opts?.nearbyMinIntervalMs ?? PLACE_SEARCH_DEFAULTS.nearbyMinIntervalMs;
    this.now = opts?.now ?? (() => Date.now());
  }

  kill(): void {
    this.killed = true;
    this.lastBlockReason = 'killed';
  }

  setNearbyEnabled(enabled: boolean): void {
    this.nearbyEnabled = enabled;
  }

  isNearbyEnabled(): boolean {
    return this.nearbyEnabled && !this.killed;
  }

  getStats(): PlaceSearchBudgetStats {
    return {
      networkRequests: this.networkRequests,
      byMeter: { ...this.byMeter },
      blockedSkips: this.blockedSkips,
      throttledSkips: this.throttledSkips,
      errors: this.errors,
      consecutiveErrors: this.consecutiveErrors,
      budgetRemaining: Math.max(0, this.maxSessionRequests - this.networkRequests),
      killed: this.killed,
      nearbyEnabled: this.nearbyEnabled,
      lastBlockReason: this.lastBlockReason,
    };
  }

  /**
   * Gate a billed call. Nearby extras also require the opt-in toggle.
   * Street View coverage lookups are billed against the session budget but
   * are allowed without nearby opt-in (user-initiated search).
   */
  allow(
    meter: PlaceSearchMeter,
    opts?: { skipThrottle?: boolean },
  ): { ok: true } | { ok: false; reason: PlaceSearchBlockReason } {
    if (this.killed) {
      this.blockedSkips += 1;
      this.lastBlockReason = 'killed';
      return { ok: false, reason: 'killed' };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.blockedSkips += 1;
      this.lastBlockReason = 'offline';
      return { ok: false, reason: 'offline' };
    }
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.blockedSkips += 1;
      this.lastBlockReason = 'error-backoff';
      return { ok: false, reason: 'error-backoff' };
    }
    if (this.networkRequests >= this.maxSessionRequests) {
      this.blockedSkips += 1;
      this.lastBlockReason = 'budget-exhausted';
      return { ok: false, reason: 'budget-exhausted' };
    }
    if (meter === 'nearby' && !this.nearbyEnabled) {
      this.blockedSkips += 1;
      this.lastBlockReason = 'nearby-off';
      return { ok: false, reason: 'nearby-off' };
    }
    if (meter === 'nearby' && !opts?.skipThrottle) {
      const elapsed = this.now() - this.lastNearbyAt;
      if (this.lastNearbyAt > 0 && elapsed < this.nearbyMinIntervalMs) {
        this.throttledSkips += 1;
        return { ok: false, reason: 'throttled' };
      }
    }
    return { ok: true };
  }

  recordSuccess(meter: PlaceSearchMeter): void {
    this.networkRequests += 1;
    this.byMeter[meter] += 1;
    this.consecutiveErrors = 0;
    if (meter === 'nearby') this.lastNearbyAt = this.now();
  }

  recordError(meter: PlaceSearchMeter): void {
    this.networkRequests += 1;
    this.byMeter[meter] += 1;
    this.errors += 1;
    this.consecutiveErrors += 1;
  }
}

let sessionBudget: PlaceSearchBudget | null = null;

export function getPlaceSearchBudget(): PlaceSearchBudget {
  if (!sessionBudget) sessionBudget = new PlaceSearchBudget();
  return sessionBudget;
}

/** Test-only: replace the process-wide session budget. */
export function resetPlaceSearchBudgetForTests(budget?: PlaceSearchBudget): void {
  sessionBudget = budget ?? new PlaceSearchBudget();
}

export function installPlaceSearchKillSwitch(budget: PlaceSearchBudget = getPlaceSearchBudget()): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __PLACE_SEARCH__?: unknown }).__PLACE_SEARCH__ = {
    kill: () => budget.kill(),
    getStats: () => budget.getStats(),
  };
}
