#!/usr/bin/env node
/**
 * Build-time inputs of the offline-shell service worker (`public/service-worker.js`).
 *
 * `.wasm` and `.wgsl` are served under unhashed names and cached cache-first, so
 * the worker's cache name has to change whenever their bytes do; otherwise a
 * returning user pairs the new hashed JS with the old cached binary. The cache id
 * is a hash of the shipped wasm + shader bytes and the build version; the shader
 * precache list is the real shader set, not a hand-kept one.
 *
 * `scripts/stamp-sw.mjs` applies this to `build/service-worker.js`; the source
 * file stays untouched (its stamp lines hold dev defaults).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Always precached; the shaders are appended from disk. Relative to the app root. */
export const STATIC_PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './wasm/streetview-wasm.wasm',
  // The cabin AudioWorklet's engine (SIMD128 build of the same sources).
  './wasm/streetview-wasm.simd.wasm',
  './icons/icon.svg',
];

/** Entries of `STATIC_PRECACHE_URLS` that are build output, not files under `public/`. */
export const GENERATED_PRECACHE_URLS = ['./', './index.html'];

const CACHE_ID_STAMP = /^const CACHE_ID = .*\/\/ @sw-stamp:cache-id$/m;
const SHADERS_STAMP = /^const SHADER_URLS = .*\/\/ @sw-stamp:shaders$/m;

function walk(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, next));
    else out.push(next);
  }
  return out;
}

/** `./shaders/**\/*.wgsl` under `root` (a `public/` or `build/` directory), sorted. */
export function listShaderUrls(root) {
  const dir = join(root, 'shaders');
  if (!existsSync(dir)) return [];
  return walk(dir)
    .filter((file) => file.endsWith('.wgsl'))
    .sort()
    .map((file) => `./shaders/${file}`);
}

/** The full precache list a service worker built from `root` carries. */
export function buildPrecacheUrls(root) {
  return [...STATIC_PRECACHE_URLS, ...listShaderUrls(root)];
}

/** 12 hex chars over every cached-by-name asset's bytes plus the build version. */
export function swCacheId(root, buildVersion = '') {
  const hash = createHash('sha256');
  hash.update(`build:${buildVersion}\0`);
  const files = [
    ...listShaderUrls(root),
    ...walk(join(root, 'wasm'))
      .filter((file) => file.endsWith('.wasm'))
      .sort()
      .map((file) => `./wasm/${file}`),
  ];
  for (const url of files) {
    hash.update(url);
    hash.update('\0');
    hash.update(readFileSync(join(root, url)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** Replaces the two stamp lines of the worker source; throws if either is gone. */
export function stampServiceWorker(source, { cacheId, shaderUrls }) {
  if (!CACHE_ID_STAMP.test(source) || !SHADERS_STAMP.test(source)) {
    throw new Error('service-worker.js lost its @sw-stamp lines — nothing to stamp');
  }
  return source
    .replace(CACHE_ID_STAMP, () => `const CACHE_ID = ${JSON.stringify(cacheId)}; // @sw-stamp:cache-id`)
    .replace(SHADERS_STAMP, () => `const SHADER_URLS = ${JSON.stringify(shaderUrls)}; // @sw-stamp:shaders`);
}
