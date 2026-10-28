// @vitest-environment jsdom
/**
 * The Maps canvas source is the one reader of the Maps canvas: every watcher
 * shares its samples, and Maps' DOM churn reaches the scraper as at most one
 * structure event per frame — for canvas add/remove only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({ calls: 0, resolvers: [] as Array<(fp: string) => void>, deferred: false }));
vi.mock('./canvasFingerprint', () => ({
    readCanvasFingerprint: (c: HTMLCanvasElement) => {
        reads.calls += 1;
        if (reads.deferred) return new Promise<string>((resolve) => reads.resolvers.push(resolve));
        return Promise.resolve(`${c.width}x${c.height}-1`);
    },
}));

import { MapsCanvasSource, UPLOAD_VERDICT_MAX_AGE_MS } from './mapsCanvasSource';

function canvas(w = 640, h = 480): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

let now = 0;
beforeEach(() => {
    reads.calls = 0;
    reads.resolvers = [];
    reads.deferred = false;
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('MapsCanvasSource samples', () => {
    it('shares a sample within maxAgeMs and takes a new one past it', async () => {
        const source = new MapsCanvasSource();
        const c = canvas();
        expect(await source.fingerprint(c)).toBe('640x480-1');
        now += 40;
        await source.fingerprint(c, { maxAgeMs: 50 });
        expect(reads.calls).toBe(1);
        now += 20;
        await source.fingerprint(c, { maxAgeMs: 50 });
        expect(reads.calls).toBe(2);
        expect(source.stats()).toMatchObject({ samples: 2, shared: 1 });
    });

    it('never runs two readbacks of one canvas at once', async () => {
        reads.deferred = true;
        const source = new MapsCanvasSource();
        const c = canvas();
        const a = source.fingerprint(c);
        const b = source.fingerprint(c);
        expect(reads.calls).toBe(1);
        reads.resolvers[0]!('fp');
        expect(await a).toBe('fp');
        expect(await b).toBe('fp');
    });

    it('forgets a verdict when the backing size changes', async () => {
        const source = new MapsCanvasSource();
        const c = canvas();
        await source.fingerprint(c);
        expect(source.peek(c)?.fp).toBe('640x480-1');
        c.width = 1280;
        expect(source.peek(c)).toBeUndefined();
    });

    it('answers the upload guard from the shared verdict, refreshing it in the background when stale', async () => {
        const source = new MapsCanvasSource();
        const c = canvas();
        expect(source.isShowingImagery(c)).toBe(false);
        await Promise.resolve();
        expect(source.isShowingImagery(c)).toBe(true);
        expect(reads.calls).toBe(1);
        for (let i = 0; i < 100; i++) {
            now += 16;
            source.isShowingImagery(c);
        }
        // 1.6 s of frames: still the one sample.
        expect(reads.calls).toBe(1);
        now += UPLOAD_VERDICT_MAX_AGE_MS;
        expect(source.isShowingImagery(c)).toBe(true);
        expect(reads.calls).toBe(2);
    });

    it('bumps version and notifies on every promotion', () => {
        const source = new MapsCanvasSource();
        const listener = vi.fn();
        source.subscribe(listener);
        const c = canvas();
        const v0 = source.version();
        source.setElement(c);
        source.setElement(c);
        expect(source.element()).toBe(c);
        expect(source.version()).toBe(v0 + 2);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe('MapsCanvasSource structure events', () => {
    it('coalesces a burst of canvas mutations into one event per frame', async () => {
        const source = new MapsCanvasSource();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onStructure = vi.fn();
        const stop = source.observe(container);
        source.onStructureChange(onStructure);

        for (let i = 0; i < 20; i++) container.appendChild(canvas());
        const wrapper = document.createElement('div');
        wrapper.appendChild(canvas());
        container.appendChild(wrapper);
        await Promise.resolve();
        await nextFrame();
        expect(onStructure).toHaveBeenCalledTimes(1);

        container.removeChild(wrapper);
        await Promise.resolve();
        await nextFrame();
        expect(onStructure).toHaveBeenCalledTimes(2);
        expect(source.stats().structureEvents).toBe(2);
        stop();
        container.remove();
    });

    it('ignores Maps DOM churn that adds or removes no canvas', async () => {
        const source = new MapsCanvasSource();
        const container = document.createElement('div');
        const onStructure = vi.fn();
        const stop = source.observe(container);
        source.onStructureChange(onStructure);
        for (let i = 0; i < 50; i++) {
            const tile = document.createElement('div');
            container.appendChild(tile);
            tile.remove();
        }
        await Promise.resolve();
        await nextFrame();
        expect(onStructure).not.toHaveBeenCalled();
        expect(reads.calls).toBe(0);
        stop();
    });
});
