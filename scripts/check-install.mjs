#!/usr/bin/env node
/**
 * scripts/check-install.mjs
 *
 * Verify node_modules actually contains every dependency package.json declares.
 *
 * Why this exists: a partial or interrupted install does not fail loudly — it
 * fails as a pile of type errors that look like application bugs. When `vite`,
 * `vitest`, `@webgpu/types` or `@testing-library/jest-dom` are missing, the
 * ambient types they provide vanish and `tsc` reports dozens of unrelated-looking
 * errors: every `*.module.css` import becomes "cannot find module" (that wildcard
 * is declared by `vite/client`), every `toBeInTheDocument()` becomes an untyped
 * matcher, and `/// <reference types="vitest/globals" />` in src/vite-env.d.ts
 * cannot resolve. Roughly 57 errors from one missing install step, none of which
 * point at the cause.
 *
 * Run automatically before `npm run typecheck` and `npm test` (see the
 * pretypecheck / pretest hooks in package.json), and explicitly in CI after
 * `npm ci`.
 *
 * Usage:
 *   node scripts/check-install.mjs [--verbose]
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

const fail = (lines) => {
  console.error(`\n❌ Incomplete install — node_modules does not match package.json.\n`);
  for (const line of lines) console.error(line);
  console.error(`\n   Fix: rm -rf node_modules && npm ci\n`);
  console.error(`   (Use 'npm ci' rather than 'npm install' in clean environments —`);
  console.error(`   it installs exactly the lockfile and removes stale trees.)\n`);
  process.exit(1);
};

if (!existsSync(join(repoRoot, 'node_modules'))) {
  fail(['   node_modules/ does not exist at all.']);
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

/**
 * Packages whose absence silently degrades `tsc` rather than producing an
 * obvious module-not-found at the import site. Called out by name so the error
 * message can explain the blast radius.
 */
const TYPE_CRITICAL = new Map([
  ['vite', 'declares the *.module.css and *.svg wildcards (vite/client)'],
  ['vitest', 'provides vitest/globals, referenced by src/vite-env.d.ts'],
  ['@testing-library/jest-dom', 'types toBeInTheDocument / toHaveTextContent'],
  ['@webgpu/types', 'provides GPUDevice, GPUBuffer, … used across src/renderer'],
  ['@types/google.maps', 'provides the google.maps namespace'],
]);

/** Executables the npm scripts invoke directly. */
const REQUIRED_BINS = ['vitest', 'tsc', 'eslint', 'vite'];

const missing = declared.filter((name) => !existsSync(join(repoRoot, 'node_modules', name)));
const missingBins = REQUIRED_BINS.filter(
  (bin) => !existsSync(join(repoRoot, 'node_modules', '.bin', bin)),
);

if (missing.length > 0 || missingBins.length > 0) {
  const lines = [];

  const critical = missing.filter((name) => TYPE_CRITICAL.has(name));
  if (critical.length > 0) {
    lines.push('   Missing packages that break typecheck in non-obvious ways:');
    for (const name of critical) lines.push(`     - ${name}  (${TYPE_CRITICAL.get(name)})`);
    lines.push('');
  }

  const rest = missing.filter((name) => !TYPE_CRITICAL.has(name));
  if (rest.length > 0) {
    const shown = rest.slice(0, 15);
    lines.push(`   Missing packages (${rest.length}):`);
    for (const name of shown) lines.push(`     - ${name}`);
    if (rest.length > shown.length) lines.push(`     … and ${rest.length - shown.length} more`);
    lines.push('');
  }

  if (missingBins.length > 0) {
    lines.push(`   Missing executables in node_modules/.bin: ${missingBins.join(', ')}`);
  }

  fail(lines);
}

if (verbose) {
  console.log(
    `✅ Install complete — ${declared.length} declared packages present, ` +
    `${REQUIRED_BINS.length} required binaries linked.`,
  );
}
