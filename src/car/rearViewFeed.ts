/**
 * rearViewFeed — billing-aware rear imagery source for the cabin mirror.
 *
 * The live Google Maps canvas is a forward-facing *perspective* capture, so it
 * can never be UV-shifted into a true rear view (see `RearviewMirror.ts`). The
 * only way to show what is actually behind the car, without standing up a
 * second live panorama + scraper, is a Street View **Static API** sample taken
 * at `carHeading + 180`.
 *
 * The Static API is billable per request, so this module is built around cost
 * control rather than freshness:
 *
 * - **Off by default.** Nothing is fetched until `setEnabled(true)`.
 * - **Throttled.** At most one network request every `minIntervalMs`
 *   (default 3s), regardless of how fast the car moves.
 * - **Deduped.** Results are keyed by panorama id (or quantized lat/lng) plus a
 *   coarse heading bucket, so re-entering a pano or jittering the heading
 *   re-uses the sample already in memory.
 * - **Budgeted.** A hard per-session request ceiling (`maxSessionRequests`)
 *   acts as a runaway guard; once spent the feed blocks itself permanently.
 * - **Kill switch.** `kill()` aborts in-flight work, drops the cache, and
 *   refuses every subsequent request for the life of the page.
 * - **Blockable.** Offline, Maps auth failure, and Low quality each pin the
 *   feed to "blocked" so zero requests leave the page in those states.
 *
 * Caching is **session memory only** (a bounded `Map`). Google imagery is never
 * written to Cache Storage / IndexedDB — `resolveSwFetchStrategy` in
 * `src/offline/swPolicy.ts` independently forces `network-only` for Google
 * hosts, and nothing here may weaken that.
 *
 * See `BILLING_SAFETY_CHECKLIST.md` before changing any default in this file.
 */

/** Street View Static API endpoint. Billable per successful request. */
const STATIC_ENDPOINT = 'https://maps.googleapis.com/maps/api/streetview';

export const REAR_VIEW_DEFAULTS = {
    /** Small enough to stay cheap to decode; the mirror glass is ~280x100px. */
    size: '320x180',
    /** Roughly a real interior mirror's useful field. */
    fov: 90,
    pitch: 0,
    /** Minimum spacing between *network* requests while driving. */
    minIntervalMs: 3000,
    /** Hard per-session ceiling — runaway guard, not a usage target. */
    maxSessionRequests: 200,
    /** Bounded LRU of decoded samples held in memory only. */
    cacheLimit: 48,
    /** Consecutive failures that trip the circuit breaker (e.g. a 403 storm). */
    maxConsecutiveErrors: 5,
    /** ~1.1m at the equator — finer than the gap between panoramas. */
    positionPrecision: 5,
    /** Heading quantization for cache keys; also the re-fetch trigger. */
    headingBucketDeg: 15,
} as const;

/** Anything Three.js can turn into a texture. */
export type RearViewImageSource = HTMLImageElement | ImageBitmap;

export type RearViewBlockReason =
    | 'disabled'
    | 'no-key'
    | 'offline'
    | 'auth-failed'
    | 'low-quality'
    | 'budget-exhausted'
    | 'error-backoff'
    | 'killed';

/** External conditions that pin the feed off. All of these mean zero fetches. */
export type RearViewBlocker = Extract<
    RearViewBlockReason,
    'offline' | 'auth-failed' | 'low-quality'
>;

export interface RearViewRequest {
    lat: number;
    lng: number;
    /** Car body heading in degrees; the sample is taken at heading + 180. */
    carHeading: number;
    /** Preferred when known — stable across tiny GPS jitter and cheaper to key. */
    panoId?: string;
}

export interface RearViewSample {
    image: RearViewImageSource;
    /** Compass heading the imagery faces (`carHeading + 180`, normalized). */
    imageHeading: number;
    /** Car heading at capture time — the mirror registers UV drift against it. */
    carHeading: number;
    fov: number;
    cacheKey: string;
    fetchedAt: number;
}

export type RearViewResultStatus =
    | 'blocked'
    | 'throttled'
    | 'pending'
    | 'cached'
    | 'fetched'
    | 'error';

export interface RearViewResult {
    status: RearViewResultStatus;
    sample?: RearViewSample;
    reason?: RearViewBlockReason;
    error?: Error;
}

export interface RearViewFeedStats {
    /** Billable requests actually issued this session. */
    networkRequests: number;
    cacheHits: number;
    throttledSkips: number;
    blockedSkips: number;
    errors: number;
    consecutiveErrors: number;
    cacheSize: number;
    /** Remaining requests before the session budget blocks the feed. */
    budgetRemaining: number;
    blockReason: RearViewBlockReason | null;
}

export type RearViewImageLoader = (
    url: string,
    signal: AbortSignal
) => Promise<RearViewImageSource>;

export interface RearViewFeedOptions {
    apiKey?: string;
    size?: string;
    fov?: number;
    pitch?: number;
    minIntervalMs?: number;
    maxSessionRequests?: number;
    cacheLimit?: number;
    maxConsecutiveErrors?: number;
    headingBucketDeg?: number;
    positionPrecision?: number;
    /** Injectable for tests; defaults to a crossOrigin <img> decode. */
    loadImage?: RearViewImageLoader;
    /** Injectable clock so throttle behaviour is deterministic in tests. */
    now?: () => number;
}

/** Normalize any degree value into [0, 360). */
export function normalizeDeg(deg: number): number {
    const wrapped = deg % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Signed shortest angular difference `a - b`, in (-180, 180]. */
export function signedHeadingDelta(a: number, b: number): number {
    return ((((a - b) % 360) + 540) % 360) - 180;
}

export interface RearViewUrlParams {
    apiKey: string;
    /** Compass heading the *camera* should face (already includes the +180). */
    heading: number;
    lat?: number;
    lng?: number;
    panoId?: string;
    size?: string;
    fov?: number;
    pitch?: number;
}

/**
 * Build a Street View Static API URL for a rear-facing sample.
 *
 * `pano` wins over `location` when available: it pins the sample to the exact
 * panorama the driver is standing in, which both looks right and dedupes
 * better. `return_error_code` makes missing imagery a 404 instead of a billed
 * "no imagery available" grey placeholder.
 */
export function buildRearViewUrl(params: RearViewUrlParams): string {
    const {
        apiKey,
        heading,
        lat,
        lng,
        panoId,
        size = REAR_VIEW_DEFAULTS.size,
        fov = REAR_VIEW_DEFAULTS.fov,
        pitch = REAR_VIEW_DEFAULTS.pitch,
    } = params;

    if (!apiKey) throw new Error('[rearViewFeed] API key required');
    if (!panoId && (lat === undefined || lng === undefined)) {
        throw new Error('[rearViewFeed] panoId or lat/lng required');
    }

    const query = new URLSearchParams();
    query.set('size', size);
    if (panoId) {
        query.set('pano', panoId);
    } else {
        query.set('location', `${lat},${lng}`);
    }
    query.set('heading', normalizeDeg(heading).toFixed(1));
    query.set('fov', String(fov));
    query.set('pitch', String(pitch));
    query.set('return_error_code', 'true');
    query.set('key', apiKey);

    return `${STATIC_ENDPOINT}?${query.toString()}`;
}

export interface RearViewCacheKeyParams {
    lat: number;
    lng: number;
    /** Camera heading (rear-facing), not the car heading. */
    heading: number;
    panoId?: string;
    headingBucketDeg?: number;
    positionPrecision?: number;
}

/**
 * Cache/dedupe key. Position is quantized to ~1m and heading into coarse
 * buckets so ordinary driving jitter re-uses a sample instead of buying a new
 * one. Deliberately excludes the API key — keys must never leak into logs or
 * diagnostics that surface cache keys.
 */
export function rearViewCacheKey(params: RearViewCacheKeyParams): string {
    const {
        lat,
        lng,
        heading,
        panoId,
        headingBucketDeg = REAR_VIEW_DEFAULTS.headingBucketDeg,
        positionPrecision = REAR_VIEW_DEFAULTS.positionPrecision,
    } = params;

    const bucket = Math.round(normalizeDeg(heading) / headingBucketDeg) %
        Math.round(360 / headingBucketDeg);
    const place = panoId
        ? `pano:${panoId}`
        : `loc:${lat.toFixed(positionPrecision)},${lng.toFixed(positionPrecision)}`;
    return `${place}|h${bucket}`;
}

/** Default loader: a plain crossOrigin image decode, no Cache Storage writes. */
function defaultLoadImage(url: string, signal: AbortSignal): Promise<RearViewImageSource> {
    return new Promise<RearViewImageSource>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const onAbort = () => {
            img.onload = null;
            img.onerror = null;
            img.src = '';
            reject(new Error('[rearViewFeed] request aborted'));
        };

        img.onload = () => {
            signal.removeEventListener('abort', onAbort);
            resolve(img);
        };
        img.onerror = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new Error('[rearViewFeed] rear image failed to load'));
        };

        signal.addEventListener('abort', onAbort, { once: true });
        img.src = url;
    });
}

/**
 * Throttled, budgeted rear-imagery fetcher.
 *
 * One instance per car-mode session. Call `request()` as often as you like —
 * it is cheap and self-limiting; it only reaches the network when enabled,
 * unblocked, past the throttle window, uncached, and inside budget.
 */
export class RearViewFeed {
    private readonly opts: Required<Omit<RearViewFeedOptions, 'apiKey'>>;
    private apiKey: string;

    /** Session-memory LRU of decoded samples. Never persisted. */
    private cache = new Map<string, RearViewSample>();
    private inFlight = new Map<string, Promise<RearViewSample>>();
    private controllers = new Set<AbortController>();

    private enabled = false;
    private killed = false;
    private blockers = new Set<RearViewBlocker>();

    private lastRequestAt = Number.NEGATIVE_INFINITY;
    private networkRequests = 0;
    private cacheHits = 0;
    private throttledSkips = 0;
    private blockedSkips = 0;
    private errors = 0;
    private consecutiveErrors = 0;

    constructor(options: RearViewFeedOptions = {}) {
        this.apiKey = (options.apiKey ?? '').trim();
        this.opts = {
            size: options.size ?? REAR_VIEW_DEFAULTS.size,
            fov: options.fov ?? REAR_VIEW_DEFAULTS.fov,
            pitch: options.pitch ?? REAR_VIEW_DEFAULTS.pitch,
            minIntervalMs: options.minIntervalMs ?? REAR_VIEW_DEFAULTS.minIntervalMs,
            maxSessionRequests:
                options.maxSessionRequests ?? REAR_VIEW_DEFAULTS.maxSessionRequests,
            cacheLimit: options.cacheLimit ?? REAR_VIEW_DEFAULTS.cacheLimit,
            maxConsecutiveErrors:
                options.maxConsecutiveErrors ?? REAR_VIEW_DEFAULTS.maxConsecutiveErrors,
            headingBucketDeg: options.headingBucketDeg ?? REAR_VIEW_DEFAULTS.headingBucketDeg,
            positionPrecision:
                options.positionPrecision ?? REAR_VIEW_DEFAULTS.positionPrecision,
            loadImage: options.loadImage ?? defaultLoadImage,
            now: options.now ?? (() => Date.now()),
        };
    }

    /** Master switch — the settings toggle. Off means zero network requests. */
    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        if (!enabled) this.abortInFlight();
    }

    isEnabled(): boolean {
        return this.enabled && !this.killed;
    }

    setApiKey(key: string): void {
        const next = (key ?? '').trim();
        if (next === this.apiKey) return;
        this.apiKey = next;
        // Imagery is key-scoped; a key change invalidates what we hold.
        this.clearCache();
    }

    /** Pin the feed off for an external condition (offline / auth / quality). */
    setBlocked(blocker: RearViewBlocker, active: boolean): void {
        const had = this.blockers.has(blocker);
        if (active === had) return;
        if (active) {
            this.blockers.add(blocker);
            this.abortInFlight();
        } else {
            this.blockers.delete(blocker);
        }
    }

    /**
     * Permanent kill switch. Aborts in-flight work, drops every cached sample,
     * and refuses all further requests for the life of the page. Intended for
     * the billing "stop everything now" path — there is no un-kill.
     */
    kill(): void {
        this.killed = true;
        this.enabled = false;
        this.abortInFlight();
        this.clearCache();
    }

    isKilled(): boolean {
        return this.killed;
    }

    /** Why the next request would be refused, or null if it would proceed. */
    getBlockReason(): RearViewBlockReason | null {
        if (this.killed) return 'killed';
        if (!this.enabled) return 'disabled';
        if (!this.apiKey) return 'no-key';
        if (this.blockers.has('offline')) return 'offline';
        if (this.blockers.has('auth-failed')) return 'auth-failed';
        if (this.blockers.has('low-quality')) return 'low-quality';
        if (this.networkRequests >= this.opts.maxSessionRequests) return 'budget-exhausted';
        // Circuit breaker: a referrer-blocked or unbilled key fails every
        // request, and every failed request is still a request. Stop paying to
        // rediscover that. Cleared by any success (see `resetErrorStreak`).
        if (this.consecutiveErrors >= this.opts.maxConsecutiveErrors) return 'error-backoff';
        return null;
    }

    /**
     * Ask for rear imagery at the given pose.
     *
     * Never throws: transport failures come back as `status: 'error'` so the
     * mirror can fall back to its honest unavailable glass.
     */
    async request(req: RearViewRequest): Promise<RearViewResult> {
        const blockReason = this.getBlockReason();
        if (blockReason) {
            this.blockedSkips++;
            return { status: 'blocked', reason: blockReason };
        }

        const imageHeading = normalizeDeg(req.carHeading + 180);
        const cacheKey = rearViewCacheKey({
            lat: req.lat,
            lng: req.lng,
            heading: imageHeading,
            ...(req.panoId ? { panoId: req.panoId } : {}),
            headingBucketDeg: this.opts.headingBucketDeg,
            positionPrecision: this.opts.positionPrecision,
        });

        const cached = this.cache.get(cacheKey);
        if (cached) {
            // Refresh LRU recency.
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, cached);
            this.cacheHits++;
            return { status: 'cached', sample: cached };
        }

        if (this.inFlight.has(cacheKey)) {
            return { status: 'pending' };
        }

        const now = this.opts.now();
        if (now - this.lastRequestAt < this.opts.minIntervalMs) {
            this.throttledSkips++;
            return { status: 'throttled' };
        }

        this.lastRequestAt = now;
        this.networkRequests++;

        const url = buildRearViewUrl({
            apiKey: this.apiKey,
            heading: imageHeading,
            lat: req.lat,
            lng: req.lng,
            ...(req.panoId ? { panoId: req.panoId } : {}),
            size: this.opts.size,
            fov: this.opts.fov,
            pitch: this.opts.pitch,
        });

        const controller = new AbortController();
        this.controllers.add(controller);

        const pending = this.opts
            .loadImage(url, controller.signal)
            .then((image): RearViewSample => {
                const sample: RearViewSample = {
                    image,
                    imageHeading,
                    carHeading: normalizeDeg(req.carHeading),
                    fov: this.opts.fov,
                    cacheKey,
                    fetchedAt: this.opts.now(),
                };
                this.storeSample(sample);
                this.consecutiveErrors = 0;
                return sample;
            })
            .finally(() => {
                this.controllers.delete(controller);
                this.inFlight.delete(cacheKey);
            });

        this.inFlight.set(cacheKey, pending);

        try {
            const sample = await pending;
            return { status: 'fetched', sample };
        } catch (err) {
            this.errors++;
            this.consecutiveErrors++;
            return {
                status: 'error',
                error: err instanceof Error ? err : new Error(String(err)),
            };
        }
    }

    getStats(): RearViewFeedStats {
        return {
            networkRequests: this.networkRequests,
            cacheHits: this.cacheHits,
            throttledSkips: this.throttledSkips,
            blockedSkips: this.blockedSkips,
            errors: this.errors,
            consecutiveErrors: this.consecutiveErrors,
            cacheSize: this.cache.size,
            budgetRemaining: Math.max(0, this.opts.maxSessionRequests - this.networkRequests),
            blockReason: this.getBlockReason(),
        };
    }

    /**
     * Clear a tripped error circuit breaker — e.g. after the driver fixes the
     * key or explicitly re-enables the feature. Does not refund the budget.
     */
    resetErrorStreak(): void {
        this.consecutiveErrors = 0;
    }

    /** Drop every in-memory sample. Called on key change, kill, and dispose. */
    clearCache(): void {
        for (const sample of this.cache.values()) {
            if (typeof ImageBitmap !== 'undefined' && sample.image instanceof ImageBitmap) {
                sample.image.close();
            }
        }
        this.cache.clear();
    }

    dispose(): void {
        this.enabled = false;
        this.abortInFlight();
        this.clearCache();
    }

    private storeSample(sample: RearViewSample): void {
        this.cache.set(sample.cacheKey, sample);
        while (this.cache.size > this.opts.cacheLimit) {
            const oldest = this.cache.keys().next();
            if (oldest.done) break;
            const evicted = this.cache.get(oldest.value);
            if (
                evicted &&
                typeof ImageBitmap !== 'undefined' &&
                evicted.image instanceof ImageBitmap
            ) {
                evicted.image.close();
            }
            this.cache.delete(oldest.value);
        }
    }

    private abortInFlight(): void {
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
        this.inFlight.clear();
    }
}
