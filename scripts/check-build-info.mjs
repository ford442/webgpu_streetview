#!/usr/bin/env node
/**
 * Fails when `build/build-info.json` cannot prove which commit the bundle came from.
 * Run by scripts/verify-build.sh after `vite build`.
 *
 *   node scripts/check-build-info.mjs [buildDir]
 *   SV_REQUIRE_CLEAN=1 …    also fail when tracked files differed from the commit (the Deploy workflow sets it)
 *
 * It checks the file against three witnesses: the package version, the checkout's HEAD,
 * and the main bundle (which inlines the same JSON for `window.__SV__.build`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.resolve(root, process.argv[2] ?? 'build');
const requireClean = process.env.SV_REQUIRE_CLEAN === '1';
/** @type {string[]} */
const problems = [];

const infoPath = path.join(buildDir, 'build-info.json');
/** @type {any} */
let info = null;
if (!fs.existsSync(infoPath)) {
  problems.push(`${path.relative(root, infoPath)} is missing — vite.config.ts's streetview-build-info plugin did not run`);
} else {
  try {
    info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch (error) {
    problems.push(`build-info.json is not valid JSON (${error instanceof Error ? error.message : error})`);
  }
}

if (info) {
  if (!/^[0-9a-f]{40}$/.test(info.sha)) problems.push(`sha is ${JSON.stringify(info.sha)}, not a 40-hex commit (build without .git? set SV_BUILD_SHA)`);
  if (typeof info.shortSha !== 'string' || !String(info.sha).startsWith(info.shortSha)) problems.push('shortSha is not a prefix of sha');
  if (Number.isNaN(Date.parse(info.builtAt))) problems.push(`builtAt is not a date: ${JSON.stringify(info.builtAt)}`);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (info.version !== pkg.version) problems.push(`version ${info.version} ≠ package.json ${pkg.version}`);

  if (!process.env.SV_BUILD_SHA) {
    let head = null;
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* no git here — nothing to compare with */
    }
    if (head && head !== info.sha) problems.push(`sha ${info.sha} ≠ checkout HEAD ${head} — the checkout moved after the build`);
  }

  const mainJs = fs.existsSync(path.join(buildDir, 'static/js'))
    ? fs.readdirSync(path.join(buildDir, 'static/js')).find((f) => /^main\..+\.js$/.test(f))
    : undefined;
  if (!mainJs) problems.push('no static/js/main.*.js to compare the inlined build info with');
  else if (!fs.readFileSync(path.join(buildDir, 'static/js', mainJs), 'utf8').includes(info.sha)) {
    problems.push(`${mainJs} does not contain the build sha — window.__SV__.build would not match build-info.json`);
  }

  if (info.dirty) {
    const message = 'tracked files differed from the commit at build time (the build is not reproducible from its sha)';
    if (requireClean) problems.push(message);
    else console.warn(`⚠️  build-info: ${message}`);
  }
}

if (problems.length) {
  console.error('❌ build-info check failed:');
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
console.log(`✅ build-info.json: ${info.version} · ${info.sha}${info.ref ? ` (${info.ref})` : ''} · ${info.builtAt}${info.dirty ? ' · dirty' : ''}`);
