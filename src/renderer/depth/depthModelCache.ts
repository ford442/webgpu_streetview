/**
 * The depth model's one-time download, kept in a dedicated Cache API bucket.
 *
 * Not the service worker: `/models/` is never intercepted (`offline/swPolicy.ts`),
 * so the SW neither precaches nor duplicates ~20–30 MB. The bucket name carries
 * the manifest's `cacheVersion`; any other `streetview-depth-model-*` bucket is
 * deleted on load. A download is SHA-256-checked against the manifest before it
 * is cached, so a truncated or substituted file is never served twice.
 *
 * Runs in the depth Worker (Cache API and SubtleCrypto are both available
 * there); pure over its injected I/O so it is unit-tested with fakes.
 */
import type { DepthModelFile } from './depthModel';

export interface ModelCacheIo {
    /** `self.caches`, or null where the Cache API is unavailable (insecure context, some private modes). */
    caches: CacheStorage | null;
    fetch: (url: string) => Promise<Response>;
    sha256Hex: (bytes: ArrayBuffer) => Promise<string>;
}

export interface LoadModelOptions {
    file: DepthModelFile;
    cacheName: string;
    cachePrefix: string;
    io: ModelCacheIo;
    onProgress?: (loaded: number, total: number) => void;
}

export interface LoadedModel {
    bytes: ArrayBuffer;
    fromCache: boolean;
}

export class ModelUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModelUnavailableError';
    }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Delete superseded model buckets; never touches anything outside the prefix. */
async function dropStaleBuckets(caches: CacheStorage, cacheName: string, cachePrefix: string): Promise<void> {
    const names = await caches.keys();
    await Promise.all(
        names
            .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
            .map((name) => caches.delete(name)),
    );
}

async function readWithProgress(
    response: Response,
    total: number,
    onProgress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
    if (!response.body || !onProgress) return response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

export async function loadDepthModel({
    file,
    cacheName,
    cachePrefix,
    io,
    onProgress,
}: LoadModelOptions): Promise<LoadedModel> {
    let cache: Cache | null = null;
    if (io.caches) {
        try {
            await dropStaleBuckets(io.caches, cacheName, cachePrefix);
            cache = await io.caches.open(cacheName);
            const hit = await cache.match(file.url);
            if (hit) {
                const bytes = await hit.arrayBuffer();
                // Only verified downloads are ever put, so the size is enough to
                // catch a truncated entry without re-hashing 20+ MB every boot.
                if (bytes.byteLength === file.bytes) return { bytes, fromCache: true };
                await cache.delete(file.url);
            }
        } catch {
            cache = null; // Cache API refused (quota, private mode): download, don't keep.
        }
    }

    let response: Response;
    try {
        response = await io.fetch(file.url);
    } catch (error) {
        throw new ModelUnavailableError(
            `scene-depth model unreachable (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    if (!response.ok) {
        throw new ModelUnavailableError(
            `scene-depth model not deployed (HTTP ${response.status} for ${file.url}) — `
            + 'run `npm run fetch:depth-model` before building',
        );
    }
    const bytes = await readWithProgress(response, file.bytes, onProgress);
    const digest = await io.sha256Hex(bytes);
    if (digest !== file.sha256) {
        throw new ModelUnavailableError(
            `scene-depth model failed its integrity check (sha256 ${digest.slice(0, 12)}…, expected ${file.sha256.slice(0, 12)}…)`,
        );
    }
    if (cache) {
        try {
            await cache.put(
                file.url,
                new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream' } }),
            );
        } catch {
            // Over quota: this session still runs; the next one downloads again.
        }
    }
    return { bytes, fromCache: false };
}
