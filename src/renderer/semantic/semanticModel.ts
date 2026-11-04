/**
 * What the semantic scene layer (#352) downloads, from where, and under which
 * cache key. The pins live in `semanticModel.manifest.json`, shared with
 * `scripts/fetch-models.mjs`, which rebuilds the served file from the pinned
 * source archive at deploy time (`public/models/semantic/`, not in git).
 *
 * - **Model**: DDRNet23-Slim trained on Cityscapes (MIT), via Qualcomm AI
 *   Hub's ONNX export (MIT). Rebuilt to take the depth model's ImageNet
 *   tensor at any size and to end in the 7-class head of `semanticClasses.ts`.
 *   One file for every device: the weights are stored as fp16 and cast to
 *   fp32 when the session is created, so it needs no `shader-f16`.
 * - **Runtime**: the depth Worker's — onnxruntime-web 1.30, WebGPU EP, the
 *   Worker's own device. Never an npm dependency, never in the bundle.
 */
// Named imports: Vite tree-shakes the rest of the manifest (source pins, the
// 19 upstream labels) out of the bundle.
import { bytes, cacheVersion, file, license, model, sha256 } from './semanticModel.manifest.json';
import { PUBLIC_URL } from '../../config/publicUrl';
import type { PinnedModelFile } from '../depth/depthModelCache';

export type SemanticModelFile = PinnedModelFile;

/** Cache API bucket — versioned like the depth model's, never the SW's `streetview-v1-*`. */
export const SEMANTIC_MODEL_CACHE_PREFIX = 'streetview-semantic-model-';
export const SEMANTIC_MODEL_CACHE_NAME = `${SEMANTIC_MODEL_CACHE_PREFIX}v${cacheVersion}`;

export const SEMANTIC_MODEL_NAME = model;
export const SEMANTIC_MODEL_LICENSE = license;
export const SEMANTIC_MODEL_BYTES = bytes;

/** The rebuilt model, as an absolute same-origin URL (the Worker has no document to resolve against). */
export function semanticModelFile(baseUrl: string): SemanticModelFile {
    const base = PUBLIC_URL || '.';
    return {
        url: new URL(`${base}/models/semantic/${file}`, baseUrl).href,
        bytes,
        sha256,
    };
}
