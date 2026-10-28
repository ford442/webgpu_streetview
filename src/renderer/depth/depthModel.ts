/**
 * What the scene-depth pass downloads, from where, and under which cache key.
 *
 * The pins live in `depthModel.manifest.json`, shared with
 * `scripts/fetch-depth-model.mjs` (which puts the model files into
 * `public/models/depth/` at deploy time — they are not in git). Licence and
 * provenance: `docs/SCENE_DEPTH.md`.
 *
 * - **Model**: Depth Anything V2 *Small* (Apache-2.0). Base/Large are
 *   CC-BY-NC and must not be used. Two 4-bit quantisations of the same
 *   weights: `q4f16` (f16 activations) needs `shader-f16` on the depth
 *   device; `q4` (f32 activations) runs everywhere else.
 * - **Runtime**: `onnxruntime-web`, WebGPU EP, loaded from a pinned CDN URL
 *   inside the depth Worker — never an npm dependency, never in the bundle
 *   (`depthBundleGuard.test.ts`, `scripts/check-bundle-budget.sh`).
 */
import manifest from './depthModel.manifest.json';
import { PUBLIC_URL } from '../../config/publicUrl';

export type DepthModelVariant = keyof typeof manifest.variants;

export interface DepthModelFile {
    variant: DepthModelVariant;
    /** Same-origin URL under `models/depth/`. */
    url: string;
    bytes: number;
    sha256: string;
}

/** The pinned runtime entry. One token on the main-chunk path: this URL. */
export const DEPTH_RUNTIME_URL =
    `https://cdn.jsdelivr.net/npm/${manifest.runtime.package}@${manifest.runtime.version}/${manifest.runtime.entry}`;

/** Approximate compressed size of the runtime's WebAssembly + glue (CDN, brotli). */
const DEPTH_RUNTIME_DOWNLOAD_BYTES = manifest.runtime.downloadBytes;

/**
 * Cache API bucket holding the model. Versioned so a new pin never reads a
 * stale file; older `streetview-depth-model-*` buckets are deleted on load. Not
 * the service worker's `streetview-v1-*` caches, which never see `/models/`.
 */
export const DEPTH_MODEL_CACHE_PREFIX = 'streetview-depth-model-';
export const DEPTH_MODEL_CACHE_NAME = `${DEPTH_MODEL_CACHE_PREFIX}v${manifest.cacheVersion}`;

export const DEPTH_MODEL_LICENSE = manifest.license;
export const DEPTH_MODEL_NAME = manifest.model;

/** The patch size of the ViT encoder: input sides must be multiples of it. */
const DEPTH_PATCH = 14;
/** ≈252² input pixels — the issue's "256²", rounded to the patch grid. */
const DEPTH_INPUT_PIXELS = 252 * 252;

/**
 * Input size for a canvas aspect: about `DEPTH_INPUT_PIXELS` pixels, both sides
 * multiples of `DEPTH_PATCH`, aspect kept (the model is trained on unsquashed
 * images; the preprocessor keeps aspect too).
 */
export function depthInputSize(canvasWidth: number, canvasHeight: number): { width: number; height: number } {
    const aspect = canvasWidth > 0 && canvasHeight > 0 ? canvasWidth / canvasHeight : 1;
    const clampedAspect = Math.min(Math.max(aspect, 0.25), 4);
    const snap = (v: number) => Math.max(DEPTH_PATCH, Math.round(v / DEPTH_PATCH) * DEPTH_PATCH);
    const height = snap(Math.sqrt(DEPTH_INPUT_PIXELS / clampedAspect));
    const width = snap(height * clampedAspect);
    return { width, height };
}

function modelUrl(file: string, baseUrl: string): string {
    const base = PUBLIC_URL || '.';
    return new URL(`${base}/models/depth/${file}`, baseUrl).href;
}

/** Both variants, as absolute same-origin URLs (the Worker has no document to resolve against). */
export function depthModelFiles(baseUrl: string): Record<DepthModelVariant, DepthModelFile> {
    const out = {} as Record<DepthModelVariant, DepthModelFile>;
    for (const variant of Object.keys(manifest.variants) as DepthModelVariant[]) {
        const v = manifest.variants[variant];
        out[variant] = { variant, url: modelUrl(v.file, baseUrl), bytes: v.bytes, sha256: v.sha256 };
    }
    return out;
}

/** The variant a device runs: f16 activations when it has `shader-f16`. */
export function pickDepthModelVariant(hasShaderF16: boolean): DepthModelVariant {
    return hasShaderF16 ? 'q4f16' : 'q4';
}

/** One-time download for the toggle's label: runtime + the model this device would pick. */
export function depthDownloadBytes(variant: DepthModelVariant): number {
    return DEPTH_RUNTIME_DOWNLOAD_BYTES + manifest.variants[variant].bytes;
}

export function formatMegabytes(bytes: number): string {
    return `${Math.round(bytes / 1e6)} MB`;
}
