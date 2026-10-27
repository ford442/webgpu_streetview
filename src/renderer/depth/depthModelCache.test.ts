import { describe, expect, it, vi } from 'vitest';
import { loadDepthModel, ModelUnavailableError, sha256Hex, type ModelCacheIo } from './depthModelCache';
import type { DepthModelFile } from './depthModel';

/** A Map-backed CacheStorage — enough of the surface `loadDepthModel` touches. */
function fakeCaches(initial: Record<string, Record<string, ArrayBuffer>> = {}) {
    const buckets = new Map<string, Map<string, ArrayBuffer>>(
        Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
    );
    const storage = {
        keys: async () => [...buckets.keys()],
        delete: async (name: string) => buckets.delete(name),
        open: async (name: string) => {
            if (!buckets.has(name)) buckets.set(name, new Map());
            const bucket = buckets.get(name)!;
            return {
                match: async (url: string) => {
                    const hit = bucket.get(url);
                    return hit ? new Response(hit.slice(0)) : undefined;
                },
                put: async (url: string, response: Response) => {
                    bucket.set(url, await response.arrayBuffer());
                },
                delete: async (url: string) => bucket.delete(url),
            };
        },
    };
    return { storage: storage as unknown as CacheStorage, buckets };
}

const PAYLOAD = new TextEncoder().encode('pretend this is 20 MB of onnx').buffer as ArrayBuffer;

async function fileFor(bytes: ArrayBuffer): Promise<DepthModelFile> {
    return {
        variant: 'q4f16',
        url: 'http://127.0.0.1/models/depth/depth-anything-v2-small.q4f16.onnx',
        bytes: bytes.byteLength,
        sha256: await sha256Hex(bytes),
    };
}

function io(caches: CacheStorage | null, body: ArrayBuffer | null = PAYLOAD, status = 200): ModelCacheIo & {
    fetch: ReturnType<typeof vi.fn>;
} {
    return {
        caches,
        fetch: vi.fn(async () => new Response(body ? body.slice(0) : null, { status })),
        sha256Hex,
    };
}

const CACHE = 'streetview-depth-model-v2';
const PREFIX = 'streetview-depth-model-';

describe('the depth model download', () => {
    it('downloads once, verifies the hash, caches it — then serves the cache without a request', async () => {
        const file = await fileFor(PAYLOAD);
        const { storage, buckets } = fakeCaches();
        const progress = vi.fn();

        const first = io(storage);
        const a = await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: first, onProgress: progress });
        expect(a.fromCache).toBe(false);
        expect(new Uint8Array(a.bytes)).toEqual(new Uint8Array(PAYLOAD));
        expect(first.fetch).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenLastCalledWith(PAYLOAD.byteLength, file.bytes);
        expect(buckets.get(CACHE)?.has(file.url)).toBe(true);

        const second = io(storage);
        const b = await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: second });
        expect(b.fromCache).toBe(true);
        expect(second.fetch).not.toHaveBeenCalled();
        expect(new Uint8Array(b.bytes)).toEqual(new Uint8Array(PAYLOAD));
    });

    it('drops superseded model buckets and leaves everything else (the SW caches) alone', async () => {
        const file = await fileFor(PAYLOAD);
        const { storage, buckets } = fakeCaches({
            'streetview-depth-model-v1': { [file.url]: PAYLOAD },
            'streetview-v1-static': { './index.html': PAYLOAD },
        });
        await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: io(storage) });
        expect([...buckets.keys()].sort()).toEqual([CACHE, 'streetview-v1-static']);
    });

    it('refuses a file whose hash does not match the manifest, and caches nothing', async () => {
        const file = { ...(await fileFor(PAYLOAD)), sha256: '0'.repeat(64) };
        const { storage, buckets } = fakeCaches();
        await expect(loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: io(storage) }))
            .rejects.toThrow(/integrity/);
        expect(buckets.get(CACHE)?.size ?? 0).toBe(0);
    });

    it('a missing deployment is an honest, actionable error', async () => {
        const file = await fileFor(PAYLOAD);
        const err = await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: io(null, null, 404) })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ModelUnavailableError);
        expect(String((err as Error).message)).toMatch(/HTTP 404.*fetch:depth-model/);
    });

    it('re-downloads a truncated cache entry', async () => {
        const file = await fileFor(PAYLOAD);
        const { storage } = fakeCaches({ [CACHE]: { [file.url]: PAYLOAD.slice(0, 4) } });
        const transport = io(storage);
        const loaded = await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: transport });
        expect(loaded.fromCache).toBe(false);
        expect(transport.fetch).toHaveBeenCalledTimes(1);
    });

    it('still runs without the Cache API — it just downloads every session', async () => {
        const file = await fileFor(PAYLOAD);
        const transport = io(null);
        const loaded = await loadDepthModel({ file, cacheName: CACHE, cachePrefix: PREFIX, io: transport });
        expect(loaded.fromCache).toBe(false);
        expect(transport.fetch).toHaveBeenCalledTimes(1);
    });
});
