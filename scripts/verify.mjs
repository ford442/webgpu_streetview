#!/usr/bin/env node
/**
 * `npm run verify` — the one gate. Runs every check CI runs for the JS/TS side,
 * in the order that fails fastest, and adds the native C++ goldens when a C++
 * toolchain is present.
 *
 *   npm run verify              everything
 *   npm run verify -- --fast    skip unit tests and C++ (typecheck, lint, knip, secrets, shaders)
 *   npm run verify -- --bail    stop at the first failure
 *   npm run verify -- --no-cpp  skip the native C++ goldens (CI runs those in their own job)
 *
 * Steps whose tool is not installed (naga, cmake) are reported as SKIPPED, never silently passed:
 * CI installs both, so a skip locally is not a pass there.
 */
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const bail = args.has('--bail');
const noCpp = args.has('--no-cpp');

const has = (cmd, probe = ['--version']) => spawnSync(cmd, probe, { stdio: 'ignore' }).status === 0;
const nagaBin = process.env.NAGA_BIN || 'naga';
const haveCpp = has('cmake') && (has('g++') || has('clang++') || has('c++'));

/** @type {Array<{ name: string, cmd: string, args: string[], skip?: string | null, requires?: string | null }>} */
const steps = [
  { name: 'install is complete', cmd: 'node', args: ['scripts/check-install.mjs'] },
  { name: 'typecheck (tsc -b)', cmd: 'npx', args: ['--no-install', 'tsc', '-b'] },
  { name: 'lint', cmd: 'npx', args: ['--no-install', 'eslint', '.', '--max-warnings', '0'] },
  { name: 'knip (unused files / deps)', cmd: 'npx', args: ['--no-install', 'knip', '--no-progress'] },
  { name: 'committed secrets', cmd: 'bash', args: ['scripts/check-deploy-secrets.sh'] },
  {
    name: 'unit tests',
    cmd: 'npx',
    args: ['--no-install', 'vitest', 'run'],
    skip: fast ? '--fast' : null,
  },
  {
    name: 'WGSL shaders (naga)',
    cmd: 'node',
    args: ['scripts/validate-shaders.mjs'],
    // In CI a missing naga must fail loudly, not skip (validate-shaders.mjs itself exits 0 when absent).
    skip: has(nagaBin) ? null : process.env.CI ? undefined : `'${nagaBin}' not installed (cargo install naga-cli --locked)`,
    requires: process.env.CI && !has(nagaBin) ? `'${nagaBin}' is required in CI` : null,
  },
  {
    name: 'C++ goldens (ctest)',
    cmd: 'npm',
    args: ['run', '--silent', 'test:cpp'],
    skip: fast ? '--fast' : noCpp ? '--no-cpp' : haveCpp ? null : 'cmake / C++ compiler not installed',
  },
];

const results = [];
for (const step of steps) {
  if (step.requires) {
    console.error(`\n❌ ${step.name} — ${step.requires}`);
    results.push({ name: step.name, status: 'FAILED', note: step.requires, ms: 0 });
    if (bail) break;
    continue;
  }
  if (step.skip) {
    console.log(`\n⏭  ${step.name} — SKIPPED (${step.skip})`);
    results.push({ name: step.name, status: 'skipped', note: step.skip, ms: 0 });
    continue;
  }
  console.log(`\n▶ ${step.name}`);
  const t0 = Date.now();
  const r = spawnSync(step.cmd, step.args, { stdio: 'inherit' });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  results.push({ name: step.name, status: ok ? 'passed' : 'FAILED', ms });
  if (!ok && bail) break;
}

console.log('\n──────── verify summary ────────');
for (const r of results) {
  const icon = r.status === 'passed' ? '✅' : r.status === 'skipped' ? '⏭ ' : '❌';
  const time = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : '';
  console.log(`${icon} ${r.name}${time}${r.note ? ` — ${r.note}` : ''}`);
}
const failed = results.filter((r) => r.status === 'FAILED');
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll run checks passed.');
