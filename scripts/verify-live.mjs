#!/usr/bin/env node
/**
 * Checks a DEPLOYED site against the build it was meant to receive. The last step of the
 * Deploy workflow, and the "which commit is live?" answer for a person:
 *
 *   node scripts/verify-live.mjs                              test.1ink.us, SHA from build/build-info.json
 *   node scripts/verify-live.mjs --url https://go.1ink.us/streetview/
 *   node scripts/verify-live.mjs --expect-sha <40-hex sha>    instead of reading build/build-info.json
 *   node scripts/verify-live.mjs --files                      also HEAD every file of build/ on the host
 *   node scripts/verify-live.mjs --url http://127.0.0.1:3000/ --no-isolation   a local `vite preview`
 *
 * Checks, in order — each failure is listed, the exit code is 1 if there is any:
 *   1. `build-info.json` is served and its `sha` is the expected one (so "deployed" means "this commit").
 *   2. The page's COOP is exactly `same-origin` and COEP exactly `credentialless`. A header that arrives
 *      TWICE (a vhost `Header set` plus public/.htaccess's `Header always set`) reads as
 *      `same-origin, same-origin`, which is not a valid COOP value: the browser drops it and
 *      `crossOriginIsolated` is false, which silently turns the SharedArrayBuffer audio path off.
 *   3. `--files`: every file of build/ exists on the host with the byte size it was built with (the JS
 *      bundles are patched with the Maps key at deploy time, so for those only existence is checked),
 *      and a `.wasm` not served as `application/wasm` is warned about (the loader falls back to a plain compile).
 *
 * The host rate-limits (429) bursts, so requests are sequential and a 429/5xx is retried with backoff.
 * Behind the agent proxy run with `NODE_USE_ENV_PROXY=1` (Node's fetch ignores HTTPS_PROXY otherwise).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
/** @param {string} name */
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const baseUrl = (value('--url') ?? 'https://test.1ink.us/streetview/').replace(/\/?$/, '/');
const buildDir = path.resolve(root, value('--build') ?? 'build');
const checkFiles = args.includes('--files');
const checkIsolation = !args.includes('--no-isolation');
const spacingMs = Number(value('--spacing-ms') ?? 150);
const maxAttempts = Number(value('--attempts') ?? 6);

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @type {string[]} */
const problems = [];
const fail = (/** @type {string} */ message) => {
  problems.push(message);
  console.error(`❌ ${message}`);
};

/**
 * GET/HEAD with retries on 429 and 5xx (the shared host throttles bursts) — never on 4xx otherwise.
 * @param {string} url @param {'GET' | 'HEAD'} method
 */
async function request(url, method) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { method, cache: 'no-store', redirect: 'follow' });
      if (response.status !== 429 && response.status < 500) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(Math.min(30_000, 1000 * 2 ** attempt));
  }
  throw new Error(`${method} ${url}: gave up after ${maxAttempts} attempts (${last})`);
}

/** @param {string} dir @returns {string[]} posix paths relative to dir */
function listBuildFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  // Mirrors deploy.py: source maps and build diagnostics are never uploaded. Dotfiles (public/.htaccess) ARE
  // uploaded but Apache never serves them (403 by design), so they cannot be checked over HTTP.
  return out
    .filter((f) => !f.endsWith('.map') && f !== 'chunk-graph.json' && f !== 'architecture-report.html' && !f.split('/').some((part) => part.startsWith('.')))
    .sort();
}

let expectedSha = value('--expect-sha');
const localInfoPath = path.join(buildDir, 'build-info.json');
if (!expectedSha && fs.existsSync(localInfoPath)) {
  expectedSha = JSON.parse(fs.readFileSync(localInfoPath, 'utf8')).sha;
}
if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  console.error('verify-live: need --expect-sha <40-hex> or a build/build-info.json to compare with.');
  process.exit(2);
}

console.log(`verify-live: ${baseUrl}  (expecting ${expectedSha})`);

// 1. Which commit is live?
try {
  const response = await request(`${baseUrl}build-info.json?cb=${Date.now()}`, 'GET');
  if (response.status !== 200) {
    fail(`build-info.json: HTTP ${response.status} — this deploy predates the build-info stamp, or index.html was uploaded without it`);
  } else {
    const info = await response.json();
    console.log(`   live build: ${info.version} · ${info.sha} · built ${info.builtAt}${info.dirty ? ' · DIRTY tree' : ''}`);
    if (info.sha !== expectedSha) fail(`live sha ${info.sha} ≠ expected ${expectedSha}`);
    else console.log('✅ live build-info.json matches the expected commit');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// 2. Cross-origin isolation headers on the page itself.
if (checkIsolation) {
  try {
    const response = await request(baseUrl, 'GET');
    const coop = response.headers.get('cross-origin-opener-policy');
    const coep = response.headers.get('cross-origin-embedder-policy');
    if (coop !== 'same-origin') {
      fail(
        `Cross-Origin-Opener-Policy is ${JSON.stringify(coop)}, expected "same-origin"` +
          (coop?.includes(',') ? ' — the header is sent more than once (vhost + .htaccess); unset it at one level' : ''),
      );
    }
    if (coep !== 'credentialless') {
      fail(`Cross-Origin-Embedder-Policy is ${JSON.stringify(coep)}, expected "credentialless" (never require-corp)`);
    }
    if (coop === 'same-origin' && coep === 'credentialless') console.log('✅ COOP same-origin + COEP credentialless, each sent once');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

// 3. Every built file made it.
if (checkFiles) {
  if (!fs.existsSync(buildDir)) {
    fail(`--files needs ${path.relative(root, buildDir)}/ to compare against`);
  } else {
    const files = listBuildFiles(buildDir);
    let missing = 0;
    let sized = 0;
    for (const file of files) {
      await sleep(spacingMs);
      try {
        const response = await request(`${baseUrl}${file}`, 'HEAD');
        if (response.status !== 200) {
          missing++;
          fail(`${file}: HTTP ${response.status}`);
          continue;
        }
        const patched = file.startsWith('static/js/') && file.endsWith('.js'); // Maps key baked at deploy time
        const built = fs.statSync(path.join(buildDir, file)).size;
        const served = Number(response.headers.get('content-length') ?? NaN);
        if (!patched && Number.isFinite(served) && !response.headers.get('content-encoding') && served !== built) {
          fail(`${file}: ${served} bytes live, ${built} built`);
        } else sized++;
        if (file.endsWith('.wasm') && !String(response.headers.get('content-type')).startsWith('application/wasm')) {
          // Not fatal: src/wasm/index.ts falls back to WebAssembly.compile; streaming just compiles while downloading.
          console.warn(`⚠️  ${file}: served as ${response.headers.get('content-type')}, not application/wasm (streaming compile is skipped)`);
        }
      } catch (error) {
        missing++;
        fail(error instanceof Error ? error.message : String(error));
      }
    }
    if (!missing) console.log(`✅ all ${files.length} built files are on the host (${sized} size/exist checks passed)`);
  }
}

if (problems.length) {
  console.error(`\nverify-live: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nverify-live: OK');
