import { useCallback, useEffect, useRef, useState } from 'react';
import { RearViewFeed, type RearViewFeedStats, type RearViewSample } from '../car/rearViewFeed';
import { setMirrorRearSample } from '../car';
import { getActiveQualityLevel } from '../config/visualPresets';
import { onMapsAuthFailure } from '../services/maps/loader';

/**
 * useRearViewFeed — drives the cabin mirror's true rear imagery.
 *
 * Owns one `RearViewFeed` for the lifetime of car mode and pokes it whenever
 * the car's pose changes materially. The feed itself does the cost control
 * (throttle, dedupe, session budget); this hook supplies the *policy*:
 *
 * - **Opt-in, persisted off.** The toggle defaults to disabled because Street
 *   View Static requests are billable. Nothing is fetched until the driver
 *   turns it on, and the choice survives reloads in localStorage.
 * - **Blockers.** Offline, Maps auth failure, and Low quality each pin the feed
 *   off, so those states issue exactly zero requests.
 * - **Kill switch.** `window.__REARVIEW_FEED__.kill()` from DevTools (or the
 *   returned `kill()`) permanently stops the feed and clears its cache for the
 *   rest of the page's life. See `BILLING_SAFETY_CHECKLIST.md`.
 */

const STORAGE_KEY = 'webgpu_streetview_rear_view_feed';

/** Movement that justifies spending a new request, in metres. */
const REFETCH_DISTANCE_M = 12;
/** Car rotation that justifies spending a new request, in degrees. */
const REFETCH_HEADING_DEG = 20;

export interface RearViewFeedPose {
    lat: number;
    lng: number;
    carHeading: number;
    panoId?: string;
}

export interface UseRearViewFeedParams {
    /** Effective Maps key; empty disables the feed with reason `no-key`. */
    apiKey: string;
    /** Whether car mode is currently mounted/active. */
    active: boolean;
    /** Maps auth failure from `useMapsBootstrap`; blocks all requests. */
    authFailed?: boolean;
}

export interface UseRearViewFeedResult {
    enabled: boolean;
    setEnabled: (value: boolean) => void;
    toggle: () => void;
    /** Push the current car pose; safe (and cheap) to call every frame. */
    notifyPose: (pose: RearViewFeedPose) => void;
    /** Human-readable state for the settings row. */
    status: string;
    stats: RearViewFeedStats | null;
    /** Permanent stop — no un-kill for the life of the page. */
    kill: () => void;
}

function readStoredEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/** Equirectangular metres between two lat/lng pairs — plenty at this scale. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const toRad = Math.PI / 180;
    const x = (bLng - aLng) * toRad * Math.cos(((aLat + bLat) / 2) * toRad);
    const y = (bLat - aLat) * toRad;
    return Math.sqrt(x * x + y * y) * 6371000;
}

export function useRearViewFeed({
    apiKey,
    active,
    authFailed = false,
}: UseRearViewFeedParams): UseRearViewFeedResult {
    const [enabled, setEnabledState] = useState<boolean>(readStoredEnabled);
    const [stats, setStats] = useState<RearViewFeedStats | null>(null);

    const feedRef = useRef<RearViewFeed | null>(null);
    const lastPoseRef = useRef<RearViewFeedPose | null>(null);
    const boundKeyRef = useRef<string | null>(null);
    const requestingRef = useRef(false);

    if (!feedRef.current) {
        feedRef.current = new RearViewFeed({ apiKey });
    }

    // Expose the kill switch for DevTools / incident response.
    useEffect(() => {
        const feed = feedRef.current;
        if (!feed || typeof window === 'undefined') return;
        (window as unknown as Record<string, unknown>).__REARVIEW_FEED__ = feed;
        return () => {
            delete (window as unknown as Record<string, unknown>).__REARVIEW_FEED__;
        };
    }, []);

    useEffect(() => {
        feedRef.current?.setApiKey(apiKey);
    }, [apiKey]);

    // Master switch: off unless the driver opted in *and* car mode is running.
    useEffect(() => {
        const feed = feedRef.current;
        if (!feed) return;
        feed.setEnabled(enabled && active);
        if (!(enabled && active)) {
            lastPoseRef.current = null;
            boundKeyRef.current = null;
            setMirrorRearSample(null);
        }
        setStats(feed.getStats());
    }, [enabled, active]);

    // Offline blocker — zero requests while the network is down.
    useEffect(() => {
        const feed = feedRef.current;
        if (!feed) return;
        const sync = () => feed.setBlocked('offline', !navigator.onLine);
        sync();
        window.addEventListener('online', sync);
        window.addEventListener('offline', sync);
        return () => {
            window.removeEventListener('online', sync);
            window.removeEventListener('offline', sync);
        };
    }, []);

    useEffect(() => {
        feedRef.current?.setBlocked('auth-failed', authFailed);
    }, [authFailed]);

    // A referrer-blocked or unbilled key fails Static requests too, and each
    // failure is still billable-shaped traffic. Stop the moment Maps says so.
    useEffect(() => {
        return onMapsAuthFailure(() => {
            feedRef.current?.setBlocked('auth-failed', true);
            setMirrorRearSample(null);
            setStats(feedRef.current?.getStats() ?? null);
        });
    }, []);

    // Low quality opts out entirely: the extra texture is not worth the spend
    // on a machine already struggling to hold frame rate.
    useEffect(() => {
        feedRef.current?.setBlocked('low-quality', getActiveQualityLevel() === 'low');
    }, [active]);

    useEffect(() => {
        return () => {
            feedRef.current?.dispose();
            setMirrorRearSample(null);
        };
    }, []);

    const persist = useCallback((value: boolean) => {
        try {
            window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
        } catch {
            // Private-mode storage failure must not break the toggle.
        }
    }, []);

    const setEnabled = useCallback(
        (value: boolean) => {
            setEnabledState(value);
            persist(value);
        },
        [persist]
    );

    const toggle = useCallback(() => {
        setEnabledState((prev) => {
            persist(!prev);
            return !prev;
        });
    }, [persist]);

    const kill = useCallback(() => {
        feedRef.current?.kill();
        setMirrorRearSample(null);
        setEnabled(false);
        setStats(feedRef.current?.getStats() ?? null);
    }, [setEnabled]);

    /**
     * Pose gate. The feed throttles by time; this gates by *movement*, so a
     * parked car sitting at a red light never spends a request. A pose only
     * reaches the feed after the car has moved `REFETCH_DISTANCE_M` metres,
     * turned `REFETCH_HEADING_DEG` degrees, or hopped to a new panorama.
     */
    const notifyPose = useCallback((pose: RearViewFeedPose) => {
        const feed = feedRef.current;
        if (!feed || !feed.isEnabled() || requestingRef.current) return;

        const previous = lastPoseRef.current;
        if (previous) {
            const movedFar =
                metresBetween(previous.lat, previous.lng, pose.lat, pose.lng) >=
                REFETCH_DISTANCE_M;
            const turnedFar =
                Math.abs(
                    ((((pose.carHeading - previous.carHeading) % 360) + 540) % 360) - 180
                ) >= REFETCH_HEADING_DEG;
            const newPano = Boolean(pose.panoId) && pose.panoId !== previous.panoId;
            if (!movedFar && !turnedFar && !newPano) return;
        }

        requestingRef.current = true;
        void feed
            .request(pose)
            .then((result) => {
                if (result.status === 'fetched' || result.status === 'cached') {
                    lastPoseRef.current = pose;
                    const sample = result.sample as RearViewSample;
                    if (sample.cacheKey !== boundKeyRef.current) {
                        boundKeyRef.current = sample.cacheKey;
                        setMirrorRearSample(sample);
                    }
                } else if (result.status === 'error') {
                    // No imagery here (or transport failed) — fall back to the
                    // honest unavailable glass rather than a stale rear view.
                    lastPoseRef.current = pose;
                    boundKeyRef.current = null;
                    setMirrorRearSample(null);
                }
                setStats(feed.getStats());
            })
            .finally(() => {
                requestingRef.current = false;
            });
    }, []);

    const blockReason = stats?.blockReason ?? null;
    const status = !enabled
        ? 'Off — no Street View Static requests'
        : blockReason === 'killed'
          ? 'Stopped by kill switch'
          : blockReason === 'no-key'
            ? 'Unavailable — no Maps API key'
            : blockReason === 'offline'
              ? 'Paused — offline'
              : blockReason === 'auth-failed'
                ? 'Paused — Maps auth failed'
                : blockReason === 'low-quality'
                  ? 'Unavailable at Low quality'
                  : blockReason === 'budget-exhausted'
                    ? 'Paused — session request budget spent'
                    : blockReason === 'error-backoff'
                      ? 'Paused — repeated request failures'
                      : blockReason === 'disabled'
                        ? 'Off'
                        : `On — ${stats?.networkRequests ?? 0} requests this session`;

    return { enabled, setEnabled, toggle, notifyPose, status, stats, kill };
}
