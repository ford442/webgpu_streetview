#!/usr/bin/env node
/**
 * Stamps build/service-worker.js with a content-derived cache id and the real
 * shader precache list (see scripts/sw-manifest.mjs). Runs after `vite build`.
 *
 *   node scripts/stamp-sw.mjs [buildDir]
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listShaderUrls, stampServiceWorker, swCacheId } from './sw-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.resolve(root, process.argv[2] ?? 'build');
const swPath = path.join(buildDir, 'service-worker.js');

if (!existsSync(swPath)) {
  console.error(`stamp-sw: ${swPath} does not exist — run vite build first.`);
  process.exit(1);
}

function buildVersion() {
  const fromEnv = process.env.REACT_APP_BUILD_VERSION || process.env.VITE_BUILD_VERSION;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: root }).trim();
  } catch {
    return '';
  }
}

const cacheId = swCacheId(buildDir, buildVersion());
const stamped = stampServiceWorker(readFileSync(swPath, 'utf8'), {
  cacheId,
  shaderUrls: listShaderUrls(buildDir),
});
writeFileSync(swPath, stamped);
console.log(`stamp-sw: ${path.relative(root, swPath)} cache id ${cacheId}`);
