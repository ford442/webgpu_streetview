import { describe, it, expect, vi } from 'vitest';
import {
    RearViewFeed,
    buildRearViewUrl,
    rearViewCacheKey,
    normalizeDeg,
    signedHeadingDelta,
    REAR_VIEW_DEFAULTS,
    type RearViewImageSource,
    type RearViewFeedOptions,
} from '../rearViewFeed';

/** Stand-in for a decoded image; the feed never inspects its contents. */
function fakeImage(): RearViewImageSource {
    return { tag: 'fake-image' } as unknown as RearViewImageSource;
}

/**
 * Feed wired to a manual clock and a counting loader, so throttle and dedupe
 * behaviour is asserted on exact request counts rather than timing luck.
 */
function makeFeed(overrides: RearViewFeedOptions = {}) {
    let clock = 100_000;
    const urls: string[] = [];
    let resolveWith: 'ok' | 'fail' = 'ok';

    const feed = new RearViewFeed({
        apiKey: 'test-key',
        now: () => clock,
        loadImage: async (url: string) => {
            urls.push(url);
            if (resolveWith === 'fail') throw new Error('404');
            return fakeImage();
        },
        ...overrides,
    });

    return {
        feed,
        urls,
        advance: (ms: number) => {
            clock += ms;
        },
        failNext: () => {
            resolveWith = 'fail';
        },
        succeedNext: () => {
            resolveWith = 'ok';
        },
    };
}

const POSE = { lat: 40.7128, lng: -74.006, carHeading: 90 };

describe('rearViewFeed helpers', () => {
    it('normalizes headings into [0, 360)', () => {
        expect(normalizeDeg(0)).toBe(0);
        expect(normalizeDeg(370)).toBe(10);
        expect(normalizeDeg(-10)).toBe(350);
    });

    it('computes signed shortest heading deltas across the 0/360 seam', () => {
        expect(signedHeadingDelta(10, 350)).toBe(20);
        expect(signedHeadingDelta(350, 10)).toBe(-20);
        expect(signedHeadingDelta(90, 90)).toBe(0);
    });
});

describe('buildRearViewUrl', () => {
    it('targets the Street View Static endpoint at the requested heading', () => {
        const url = new URL(
            buildRearViewUrl({ apiKey: 'k', lat: 1.5, lng: 2.5, heading: 270 })
        );
        expect(url.host).toBe('maps.googleapis.com');
        expect(url.pathname).toBe('/maps/api/streetview');
        expect(url.searchParams.get('location')).toBe('1.5,2.5');
        expect(url.searchParams.get('heading')).toBe('270.0');
        expect(url.searchParams.get('fov')).toBe(String(REAR_VIEW_DEFAULTS.fov));
        expect(url.searchParams.get('key')).toBe('k');
    });

    it('wraps out-of-range headings rather than sending them raw', () => {
        const url = new URL(
            buildRearViewUrl({ apiKey: 'k', lat: 0, lng: 0, heading: 400 })
        );
        expect(url.searchParams.get('heading')).toBe('40.0');
    });

    it('prefers pano id over location when known', () => {
        const url = new URL(
            buildRearViewUrl({ apiKey: 'k', lat: 1, lng: 2, panoId: 'PANO1', heading: 0 })
        );
        expect(url.searchParams.get('pano')).toBe('PANO1');
        expect(url.searchParams.get('location')).toBeNull();
    });

    it('asks for error codes so missing imagery is not billed as a grey placeholder', () => {
        const url = new URL(buildRearViewUrl({ apiKey: 'k', lat: 0, lng: 0, heading: 0 }));
        expect(url.searchParams.get('return_error_code')).toBe('true');
    });

    it('refuses to build a URL without a key or a location', () => {
        expect(() => buildRearViewUrl({ apiKey: '', lat: 0, lng: 0, heading: 0 })).toThrow();
        expect(() => buildRearViewUrl({ apiKey: 'k', heading: 0 })).toThrow();
    });
});

describe('rearViewCacheKey', () => {
    it('collapses sub-metre jitter and small heading wobble onto one key', () => {
        const a = rearViewCacheKey({ lat: 40.712812, lng: -74.006011, heading: 270 });
        const b = rearViewCacheKey({ lat: 40.712813, lng: -74.006012, heading: 273 });
        expect(a).toBe(b);
    });

    it('separates distinct positions and distinct heading buckets', () => {
        const base = rearViewCacheKey({ lat: 40.7128, lng: -74.006, heading: 270 });
        expect(rearViewCacheKey({ lat: 40.72, lng: -74.006, heading: 270 })).not.toBe(base);
        expect(rearViewCacheKey({ lat: 40.7128, lng: -74.006, heading: 300 })).not.toBe(base);
    });

    it('keys on pano id when present, ignoring position drift within the pano', () => {
        const a = rearViewCacheKey({ lat: 1, lng: 2, heading: 0, panoId: 'P' });
        const b = rearViewCacheKey({ lat: 9, lng: 9, heading: 0, panoId: 'P' });
        expect(a).toBe(b);
        expect(a).toContain('pano:P');
    });

    it('never embeds the API key', () => {
        expect(rearViewCacheKey({ lat: 1, lng: 2, heading: 0 })).not.toContain('key');
    });

    it('wraps the top heading bucket back onto zero', () => {
        expect(rearViewCacheKey({ lat: 1, lng: 2, heading: 359 })).toBe(
            rearViewCacheKey({ lat: 1, lng: 2, heading: 1 })
        );
    });
});

describe('RearViewFeed cost control', () => {
    it('issues zero requests until explicitly enabled', async () => {
        const { feed, urls } = makeFeed();
        const result = await feed.request(POSE);
        expect(result).toEqual({ status: 'blocked', reason: 'disabled' });
        expect(urls).toHaveLength(0);
    });

    it('issues zero requests without an API key', async () => {
        const { feed, urls } = makeFeed({ apiKey: '' });
        feed.setEnabled(true);
        const result = await feed.request(POSE);
        expect(result.status).toBe('blocked');
        expect(result.reason).toBe('no-key');
        expect(urls).toHaveLength(0);
    });

    it.each(['offline', 'auth-failed', 'low-quality'] as const)(
        'issues zero requests while blocked by %s',
        async (blocker) => {
            const { feed, urls } = makeFeed();
            feed.setEnabled(true);
            feed.setBlocked(blocker, true);

            const result = await feed.request(POSE);
            expect(result).toEqual({ status: 'blocked', reason: blocker });
            expect(urls).toHaveLength(0);

            // Clearing the blocker lets traffic resume.
            feed.setBlocked(blocker, false);
            expect((await feed.request(POSE)).status).toBe('fetched');
            expect(urls).toHaveLength(1);
        }
    );

    it('fetches once, then throttles further distinct poses inside the window', async () => {
        const { feed, urls, advance } = makeFeed({ minIntervalMs: 3000 });
        feed.setEnabled(true);

        expect((await feed.request(POSE)).status).toBe('fetched');
        expect(urls).toHaveLength(1);

        advance(1000);
        const throttled = await feed.request({ ...POSE, lat: POSE.lat + 0.01 });
        expect(throttled.status).toBe('throttled');
        expect(urls).toHaveLength(1);

        advance(2500);
        const allowed = await feed.request({ ...POSE, lat: POSE.lat + 0.02 });
        expect(allowed.status).toBe('fetched');
        expect(urls).toHaveLength(2);
    });

    it('serves a repeat pose from memory without a second request, even mid-throttle', async () => {
        const { feed, urls, advance } = makeFeed();
        feed.setEnabled(true);

        expect((await feed.request(POSE)).status).toBe('fetched');
        advance(60_000);

        const second = await feed.request(POSE);
        expect(second.status).toBe('cached');
        expect(second.sample?.cacheKey).toBeDefined();
        expect(urls).toHaveLength(1);
        expect(feed.getStats().cacheHits).toBe(1);
    });

    it('dedupes concurrent requests for the same pose into one network call', async () => {
        let release: (value: RearViewImageSource) => void = () => {};
        const urls: string[] = [];
        const feed = new RearViewFeed({
            apiKey: 'k',
            loadImage: (url: string) => {
                urls.push(url);
                return new Promise<RearViewImageSource>((resolve) => {
                    release = resolve;
                });
            },
        });
        feed.setEnabled(true);

        const first = feed.request(POSE);
        const second = await feed.request(POSE);

        expect(second.status).toBe('pending');
        expect(urls).toHaveLength(1);

        release(fakeImage());
        expect((await first).status).toBe('fetched');
        expect(urls).toHaveLength(1);
    });

    it('samples the view behind the car, not in front of it', async () => {
        const { feed, urls } = makeFeed();
        feed.setEnabled(true);

        const result = await feed.request({ ...POSE, carHeading: 90 });
        expect(result.sample?.imageHeading).toBe(270);
        expect(result.sample?.carHeading).toBe(90);
        expect(new URL(urls[0]!).searchParams.get('heading')).toBe('270.0');
    });

    it('stops permanently once the session request budget is spent', async () => {
        const { feed, urls, advance } = makeFeed({ maxSessionRequests: 2, minIntervalMs: 0 });
        feed.setEnabled(true);

        for (let i = 0; i < 5; i++) {
            advance(10);
            await feed.request({ ...POSE, lat: POSE.lat + i * 0.01 });
        }

        expect(urls).toHaveLength(2);
        expect(feed.getStats().blockReason).toBe('budget-exhausted');
        expect(feed.getStats().budgetRemaining).toBe(0);
    });

    it('trips a circuit breaker after repeated failures instead of retrying forever', async () => {
        const { feed, urls, advance, failNext } = makeFeed({
            maxConsecutiveErrors: 3,
            minIntervalMs: 0,
        });
        feed.setEnabled(true);
        failNext();

        for (let i = 0; i < 6; i++) {
            advance(10);
            await feed.request({ ...POSE, lat: POSE.lat + i * 0.01 });
        }

        expect(urls).toHaveLength(3);
        expect(feed.getStats().blockReason).toBe('error-backoff');

        feed.resetErrorStreak();
        expect(feed.getStats().blockReason).toBeNull();
    });

    it('clears the error streak after a success', async () => {
        const { feed, advance, failNext, succeedNext } = makeFeed({
            maxConsecutiveErrors: 3,
            minIntervalMs: 0,
        });
        feed.setEnabled(true);

        failNext();
        advance(10);
        await feed.request(POSE);
        expect(feed.getStats().consecutiveErrors).toBe(1);

        succeedNext();
        advance(10);
        await feed.request({ ...POSE, lat: POSE.lat + 0.01 });
        expect(feed.getStats().consecutiveErrors).toBe(0);
    });

    it('returns an error result rather than throwing when imagery is missing', async () => {
        const { feed, failNext } = makeFeed();
        feed.setEnabled(true);
        failNext();

        const result = await feed.request(POSE);
        expect(result.status).toBe('error');
        expect(result.error).toBeInstanceOf(Error);
        expect(feed.getStats().errors).toBe(1);
    });

    it('kill() blocks everything afterwards and drops the cache', async () => {
        const { feed, urls, advance } = makeFeed({ minIntervalMs: 0 });
        feed.setEnabled(true);
        await feed.request(POSE);
        expect(feed.getStats().cacheSize).toBe(1);

        feed.kill();
        advance(10_000);
        feed.setEnabled(true); // must not resurrect it

        const result = await feed.request(POSE);
        expect(result).toEqual({ status: 'blocked', reason: 'killed' });
        expect(feed.isEnabled()).toBe(false);
        expect(feed.isKilled()).toBe(true);
        expect(feed.getStats().cacheSize).toBe(0);
        expect(urls).toHaveLength(1);
    });

    it('drops cached imagery when the API key changes', async () => {
        const { feed } = makeFeed();
        feed.setEnabled(true);
        await feed.request(POSE);
        expect(feed.getStats().cacheSize).toBe(1);

        feed.setApiKey('different-key');
        expect(feed.getStats().cacheSize).toBe(0);
    });

    it('evicts oldest samples rather than growing without bound', async () => {
        const { feed, advance } = makeFeed({ cacheLimit: 2, minIntervalMs: 0 });
        feed.setEnabled(true);

        for (let i = 0; i < 4; i++) {
            advance(10);
            await feed.request({ ...POSE, lat: POSE.lat + i * 0.01 });
        }

        expect(feed.getStats().cacheSize).toBe(2);
    });

    it('disposing aborts in-flight work and clears memory', async () => {
        const abortSpy = vi.fn();
        const feed = new RearViewFeed({
            apiKey: 'k',
            loadImage: (_url: string, signal: AbortSignal) =>
                new Promise<RearViewImageSource>((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        abortSpy();
                        reject(new Error('aborted'));
                    });
                }),
        });
        feed.setEnabled(true);

        const pending = feed.request(POSE);
        feed.dispose();

        expect(abortSpy).toHaveBeenCalled();
        expect((await pending).status).toBe('error');
        expect(feed.getStats().cacheSize).toBe(0);
    });
});
