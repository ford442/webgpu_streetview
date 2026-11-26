#!/usr/bin/env node
/**
 * `npm run check:toolchain` — is this machine able to produce what CI and Deploy produce?
 * Names every missing or wrong-version tool with the command that installs it, before a
 * 20-minute build fails on the first one. The full recipe is docs/BUILD_ENVIRONMENT.md.
 *
 *   npm run check:toolchain                  everything: verify + build
 *   npm run check:toolchain -- --for verify  what `npm run verify` needs
 *   npm run check:toolchain -- --for build   what `npm run build` needs (emcc pinned to cpp/emsdk.version)
 *   npm run check:toolchain -- --for deploy  what `python deploy.py` needs
 *
 * Exit 1 when a REQUIRED tool for the chosen target is missing or the wrong version.
 * (Advisory rows — ⚠️ — never fail it.) Pins come from the repo, not from this file:
 * .nvmrc / package.json `engines` (Node), cpp/emsdk.version (emcc).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.includes('--for') ? args[args.indexOf('--for') + 1] : 'all';
if (!['all', 'verify', 'build', 'deploy'].includes(target)) {
  console.error(`check:toolchain: --for must be all | verify | build | deploy (got ${target})`);
  process.exit(2);
}
const wants = (/** @type {'verify' | 'build' | 'deploy'} */ scope) => target === 'all' ? scope !== 'deploy' : target === scope;

/** @param {string} cmd @param {string[]} cmdArgs @param {string} [shellPrefix] a `source …;` run first, to find emcc */
function run(cmd, cmdArgs, shellPrefix) {
  const result = shellPrefix
    ? spawnSync('bash', ['-c', `${shellPrefix} && ${cmd} ${cmdArgs.join(' ')}`], { encoding: 'utf8' })
    : spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  return result.error || result.status !== 0 ? null : `${result.stdout}${result.stderr}`.trim();
}
const firstLine = (/** @type {string} */ text) => text.split('\n')[0];
const readTrim = (/** @type {string} */ rel) => fs.readFileSync(path.join(root, rel), 'utf8').trim();

/** @type {Array<{ name: string, scopes: Array<'verify' | 'build' | 'deploy'>, status: 'ok' | 'missing' | 'wrong' | 'advisory', detail: string, fix?: string }>} */
const rows = [];
const add = (/** @type {typeof rows[number]} */ row) => rows.push(row);

// Node — .nvmrc is the pin, package.json `engines` the floor.
const nodeWanted = Number(readTrim('.nvmrc').replace(/^v/, '').split('.')[0]);
const nodeHave = Number(process.versions.node.split('.')[0]);
add({
  name: `Node ≥ ${nodeWanted}`,
  scopes: ['verify', 'build'],
  status: nodeHave >= nodeWanted ? 'ok' : 'wrong',
  detail: `v${process.versions.node}`,
  fix: `nvm install ${nodeWanted} && nvm use ${nodeWanted}   (or https://nodejs.org/dist/latest-v${nodeWanted}.x/; package.json \`engines\` requires ≥ ${nodeWanted}, and CI and Deploy run Node ${nodeWanted})`,
});

// npm install complete.
add({
  name: 'node_modules complete',
  scopes: ['verify', 'build'],
  status: spawnSync('node', ['scripts/check-install.mjs'], { cwd: root, stdio: 'ignore' }).status === 0 ? 'ok' : 'missing',
  detail: 'scripts/check-install.mjs',
  fix: 'npm ci',
});

// git — build-info.json records the commit (or SV_BUILD_SHA stands in for it).
const gitVersion = run('git', ['--version']);
const haveRepo = gitVersion !== null && run('git', ['-C', root, 'rev-parse', 'HEAD']) !== null;
add({
  name: 'git checkout (or SV_BUILD_SHA)',
  scopes: ['build'],
  status: haveRepo || /^[0-9a-f]{40}$/.test(process.env.SV_BUILD_SHA ?? '') ? 'ok' : 'missing',
  detail: haveRepo ? firstLine(gitVersion ?? '') : process.env.SV_BUILD_SHA ? 'SV_BUILD_SHA' : 'no .git here',
  fix: 'build from a git clone, or export SV_BUILD_SHA=<40-hex commit> (build-info.json must name a commit)',
});

// emcc — exactly cpp/emsdk.version; build-wasm.sh refuses anything else. Looked up the way build-wasm.sh does.
const emsdkWanted = readTrim('cpp/emsdk.version');
const emsdkEnvCandidates = [process.env.EMSDK_ENV, process.env.EMSDK && `${process.env.EMSDK}/emsdk_env.sh`, path.join(os.homedir(), 'emsdk/emsdk_env.sh')].filter(
  (c) => c && fs.existsSync(c),
);
const emccOutput = run('emcc', ['--version']) ?? (emsdkEnvCandidates[0] ? run('emcc', ['--version'], `source "${emsdkEnvCandidates[0]}" >/dev/null 2>&1`) : null);
const emccHave = emccOutput?.match(/\)\s+(\d+\.\d+\.\d+)/)?.[1];
const prebuiltOk = process.env.CI === 'true' && process.env.SV_WASM_PREBUILT === '1';
add({
  name: `emcc ${emsdkWanted} (cpp/emsdk.version)`,
  scopes: ['build'],
  status: emccHave === emsdkWanted ? 'ok' : prebuiltOk ? 'advisory' : emccHave ? 'wrong' : 'missing',
  detail: emccHave ? `emcc ${emccHave}` : prebuiltOk ? 'absent — CI=true SV_WASM_PREBUILT=1 reuses the committed binaries when the C++ hash matches' : 'not found',
  fix: `git clone https://github.com/emscripten-core/emsdk ~/emsdk && ~/emsdk/emsdk install ${emsdkWanted} && ~/emsdk/emsdk activate ${emsdkWanted} && source ~/emsdk/emsdk_env.sh`,
});

// naga — WGSL validation; `verify` skips it locally but fails without it in CI.
const nagaBin = process.env.NAGA_BIN || 'naga';
const nagaOutput = run(nagaBin, ['--version']);
add({
  name: 'naga-cli (WGSL validation)',
  scopes: ['verify'],
  status: nagaOutput ? 'ok' : 'missing',
  detail: nagaOutput ? firstLine(nagaOutput) : 'not found',
  fix: 'cargo install naga-cli --locked   (rustup: https://rustup.rs)',
});

// cmake + a C++20 compiler — native goldens (`npm run test:cpp`).
const cmakeOutput = run('cmake', ['--version']);
add({ name: 'cmake', scopes: ['verify'], status: cmakeOutput ? 'ok' : 'missing', detail: cmakeOutput ? firstLine(cmakeOutput) : 'not found', fix: 'apt-get install cmake' });
const compilers = ['g++', 'clang++', 'c++'].map((c) => [c, run(c, ['--version'])]).filter(([, v]) => v);
add({
  name: 'C++20 compiler (g++ ≥ 11 / clang++ ≥ 14)',
  scopes: ['verify'],
  status: compilers.length ? 'ok' : 'missing',
  detail: compilers.length ? firstLine(String(compilers[0][1])) : 'not found',
  fix: 'apt-get install g++   (CI pins clang; see .github/workflows/ci.yml)',
});

// Optional: clang-format / clang-tidy for `npm run lint:cpp` (CI-only gate).
add({
  name: 'clang-format + clang-tidy (lint:cpp)',
  scopes: ['verify'],
  status: run('clang-format', ['--version']) && run('clang-tidy', ['--version']) ? 'ok' : 'advisory',
  detail: run('clang-format', ['--version']) ? 'present' : 'absent — only CI runs lint:cpp',
});

// Deploy.
const pyOutput = run('python3', ['--version']);
add({ name: 'python3 ≥ 3.9', scopes: ['deploy'], status: pyOutput ? 'ok' : 'missing', detail: pyOutput ?? 'not found', fix: 'apt-get install python3' });
add({
  name: 'python `requests`',
  scopes: ['deploy'],
  status: run('python3', ['-c', 'import requests']) !== null ? 'ok' : 'missing',
  detail: 'import requests',
  fix: 'pip install requests',
});

const icon = { ok: '✅', missing: '❌', wrong: '❌', advisory: '⚠️ ' };
let failed = 0;
console.log(`Toolchain check (target: ${target})\n`);
for (const row of rows.filter((r) => r.scopes.some(wants))) {
  console.log(`${icon[row.status]} ${row.name.padEnd(44)} ${row.detail}`);
  if ((row.status === 'missing' || row.status === 'wrong') && row.fix) {
    failed++;
    console.log(`     fix: ${row.fix}`);
  }
}
console.log(failed ? `\n${failed} required tool(s) missing or wrong — see docs/BUILD_ENVIRONMENT.md` : '\nAll required tools present.');
process.exit(failed ? 1 : 0);
