/**
 * Structured health model for the unsupported Google Maps canvas scrape.
 * Pure reducer — no DOM. StreetView.tsx dispatches events; AppShell /
 * LoadingOverlay / window.__STREETVIEW_PROBE__ consume snapshots.
 */

export type ScraperHealthStatus =
  | 'locating'
  | 'promoting'
  | 'stable'
  | 'lost'
  | 'auth-blocked'
  | 'timeout';

export type ScraperErrorReason =
  | 'auth'
  | 'timeout'
  | 'zero-size'
  | 'near-black'
  | 'detached'
  | 'no-canvas'
  | 'stalled'
  | null;

export interface ScraperHealth {
  status: ScraperHealthStatus;
  canvasCount: number;
  /** width × height of the selected (largest) canvas, or 0. */
  selectedArea: number;
  /** ms since last good fingerprint, or null if never. */
  lastFingerprintAgeMs: number | null;
  consecutiveStableTicks: number;
  lastErrorReason: ScraperErrorReason;
  /** Human-readable detail for UI / probe. */
  lastErrorDetail: string | null;
  /** True once we have successfully promoted a stable canvas this session. */
  everStable: boolean;
  updatedAt: number;
}

export type ScraperHealthEvent =
  | { type: 'reset'; now?: number }
  | { type: 'locating'; now?: number }
  | {
      type: 'scan';
      canvasCount: number;
      selectedArea: number;
      /** Candidate large enough to consider (≥256²). */
      hasCandidate: boolean;
      /** Non-empty fingerprint from getCanvasFingerprint. */
      fingerprintOk: boolean;
      now?: number;
      rejectReason?: Exclude<ScraperErrorReason, 'auth' | 'timeout' | null>;
    }
  | {
      type: 'tick';
      sameFingerprint: boolean;
      canvasCount: number;
      selectedArea: number;
      requiredStableTicks: number;
      now?: number;
    }
  | {
      type: 'promoted';
      canvasCount: number;
      selectedArea: number;
      now?: number;
    }
  | {
      type: 'lost';
      reason: Exclude<ScraperErrorReason, null>;
      detail?: string;
      canvasCount?: number;
      selectedArea?: number;
      now?: number;
    }
  | { type: 'auth_blocked'; detail?: string; now?: number }
  | {
      type: 'timeout';
      sawCandidates: boolean;
      detail?: string;
      now?: number;
    }
  | {
      type: 'self_check';
      canvasAttached: boolean;
      canvasCount: number;
      selectedArea: number;
      fingerprintChanged: boolean;
      now?: number;
    };

function clock(now?: number): number {
  return now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export function createInitialScraperHealth(now?: number): ScraperHealth {
  return {
    status: 'locating',
    canvasCount: 0,
    selectedArea: 0,
    lastFingerprintAgeMs: null,
    consecutiveStableTicks: 0,
    lastErrorReason: null,
    lastErrorDetail: null,
    everStable: false,
    updatedAt: clock(now),
  };
}

/**
 * User-facing copy keyed by failure mode. Kept here so overlay / banners /
 * tests stay aligned on distinct scrape vs auth vs timeout messaging.
 */
export function scraperHealthUserMessage(health: ScraperHealth): string | null {
  switch (health.status) {
    case 'lost':
      return (
        health.lastErrorDetail ||
        'Street View canvas scrape was lost (Google may have replaced the canvas). Reconnecting…'
      );
    case 'timeout':
      return (
        health.lastErrorDetail ||
        'Timed out waiting for a stable Street View canvas. Imagery may be unavailable here.'
      );
    case 'auth-blocked':
      return (
        health.lastErrorDetail ||
        'Google Maps authentication blocked the panorama (check API key referrer restrictions).'
      );
    case 'locating':
      return 'Looking for Street View canvas…';
    case 'promoting':
      return 'Stabilizing Street View imagery…';
    case 'stable':
      return null;
    default:
      return null;
  }
}

/** Distinct WebGPU/renderer failure copy (not scrape). */
export const WEBGPU_FAILURE_USER_MESSAGE =
  'WebGPU is unavailable or failed to initialize. Falling back to WebGL / raw Street View when possible.';

export function reduceScraperHealth(
  state: ScraperHealth,
  event: ScraperHealthEvent,
): ScraperHealth {
  const t = clock(event.now);

  switch (event.type) {
    case 'reset':
    case 'locating':
      return {
        ...createInitialScraperHealth(t),
        everStable: event.type === 'reset' ? false : state.everStable,
        status: 'locating',
      };

    case 'scan': {
      if (state.status === 'auth-blocked') return { ...state, updatedAt: t };

      const base = {
        ...state,
        canvasCount: event.canvasCount,
        selectedArea: event.selectedArea,
        updatedAt: t,
      };

      if (event.canvasCount === 0 || !event.hasCandidate) {
        // After we were stable, disappearing canvases → lost (mid-session replace).
        if (state.everStable && state.status === 'stable') {
          return {
            ...base,
            status: 'lost',
            consecutiveStableTicks: 0,
            lastErrorReason: event.canvasCount === 0 ? 'no-canvas' : 'zero-size',
            lastErrorDetail:
              event.canvasCount === 0
                ? 'No panorama canvas found in the Street View container.'
                : 'Panorama canvas is below the minimum size (still loading or replaced).',
            lastFingerprintAgeMs:
              state.lastFingerprintAgeMs === null
                ? null
                : state.lastFingerprintAgeMs + (t - state.updatedAt),
          };
        }
        return {
          ...base,
          status: state.everStable && state.status === 'lost' ? 'lost' : 'locating',
          consecutiveStableTicks: 0,
          lastErrorReason: event.rejectReason ?? (event.canvasCount === 0 ? 'no-canvas' : 'zero-size'),
          lastErrorDetail: null,
        };
      }

      if (!event.fingerprintOk) {
        if (state.everStable && state.status === 'stable') {
          // Transient near-black during a hop is expected; stay stable unless prolonged.
          // StreetView self_check / lost handles prolonged failure.
          return {
            ...base,
            consecutiveStableTicks: 0,
            lastErrorReason: event.rejectReason ?? 'near-black',
            lastFingerprintAgeMs:
              state.lastFingerprintAgeMs === null
                ? null
                : state.lastFingerprintAgeMs + (t - state.updatedAt),
          };
        }
        return {
          ...base,
          status: 'promoting',
          consecutiveStableTicks: 0,
          lastErrorReason: event.rejectReason ?? 'near-black',
          lastErrorDetail: null,
        };
      }

      // Good candidate with fingerprint — entering/continuing promote unless already stable.
      if (state.status === 'stable') {
        return {
          ...base,
          lastErrorReason: null,
          lastErrorDetail: null,
          lastFingerprintAgeMs: 0,
        };
      }

      return {
        ...base,
        status: state.status === 'lost' ? 'promoting' : 'promoting',
        lastErrorReason: null,
        lastErrorDetail: null,
        lastFingerprintAgeMs: 0,
      };
    }

    case 'tick': {
      if (state.status === 'auth-blocked' || state.status === 'timeout') {
        return { ...state, updatedAt: t };
      }
      const consecutive = event.sameFingerprint
        ? Math.min(state.consecutiveStableTicks + 1, event.requiredStableTicks + 1)
        : 1;
      const next: ScraperHealth = {
        ...state,
        canvasCount: event.canvasCount,
        selectedArea: event.selectedArea,
        consecutiveStableTicks: consecutive,
        lastFingerprintAgeMs: event.sameFingerprint ? 0 : 0,
        updatedAt: t,
        lastErrorReason: null,
        lastErrorDetail: null,
      };
      if (state.status !== 'stable') {
        next.status = 'promoting';
      }
      return next;
    }

    case 'promoted':
      return {
        ...state,
        status: 'stable',
        canvasCount: event.canvasCount,
        selectedArea: event.selectedArea,
        everStable: true,
        consecutiveStableTicks: Math.max(state.consecutiveStableTicks, 1),
        lastFingerprintAgeMs: 0,
        lastErrorReason: null,
        lastErrorDetail: null,
        updatedAt: t,
      };

    case 'lost':
      return {
        ...state,
        status: 'lost',
        canvasCount: event.canvasCount ?? state.canvasCount,
        selectedArea: event.selectedArea ?? 0,
        consecutiveStableTicks: 0,
        lastErrorReason: event.reason,
        lastErrorDetail:
          event.detail ??
          (event.reason === 'detached'
            ? 'The scraped canvas was removed from the DOM.'
            : 'Street View canvas scrape lost.'),
        lastFingerprintAgeMs:
          state.lastFingerprintAgeMs === null
            ? null
            : state.lastFingerprintAgeMs + (t - state.updatedAt),
        updatedAt: t,
      };

    case 'auth_blocked':
      return {
        ...state,
        status: 'auth-blocked',
        lastErrorReason: 'auth',
        lastErrorDetail:
          event.detail ||
          'Google Maps authentication blocked the panorama (check API key referrer restrictions).',
        consecutiveStableTicks: 0,
        updatedAt: t,
      };

    case 'timeout':
      return {
        ...state,
        status: 'timeout',
        lastErrorReason: 'timeout',
        lastErrorDetail:
          event.detail ||
          (event.sawCandidates
            ? 'Timed out waiting for stable Street View imagery.'
            : 'Timed out — no Street View canvas appeared.'),
        consecutiveStableTicks: 0,
        updatedAt: t,
      };

    case 'self_check': {
      if (state.status === 'auth-blocked') return { ...state, updatedAt: t };

      if (!event.canvasAttached) {
        return reduceScraperHealth(state, {
          type: 'lost',
          reason: 'detached',
          canvasCount: event.canvasCount,
          selectedArea: event.selectedArea,
          now: t,
        });
      }

      // Idle fingerprint change ⇒ Maps is still painting (healthy).
      if (state.status === 'stable' && event.fingerprintChanged) {
        return {
          ...state,
          canvasCount: event.canvasCount,
          selectedArea: event.selectedArea,
          lastFingerprintAgeMs: 0,
          lastErrorReason: null,
          lastErrorDetail: null,
          updatedAt: t,
        };
      }

      if (state.status === 'lost' && event.canvasCount > 0 && event.selectedArea >= 256 * 256) {
        return {
          ...state,
          status: 'promoting',
          canvasCount: event.canvasCount,
          selectedArea: event.selectedArea,
          consecutiveStableTicks: 0,
          updatedAt: t,
        };
      }

      return {
        ...state,
        canvasCount: event.canvasCount,
        selectedArea: event.selectedArea,
        lastFingerprintAgeMs:
          state.lastFingerprintAgeMs === null
            ? null
            : event.fingerprintChanged
              ? 0
              : state.lastFingerprintAgeMs + (t - state.updatedAt),
        updatedAt: t,
      };
    }

    default:
      return state;
  }
}

/**
 * Invariants for the hidden scraper container. Google stops updating the
 * panorama canvas if opacity drops; visibility must use zIndex / pointerEvents.
 * Tests assert these constants so style drifts fail CI.
 */
export const SCRAPER_CONTAINER_INVARIANTS = {
  opacity: 1,
  pointerEvents: 'none',
  minCanvasEdgePx: 256,
} as const;
