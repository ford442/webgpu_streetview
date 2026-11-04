#!/usr/bin/env node
/**
 * scripts/check-wasm-features.mjs
 *
 * The shipped binaries pin their wasm feature set (cpp/CMakeLists.txt): MVP +
 * SIMD128, bulk memory, non-trapping float-to-int, sign extension and mutable
 * globals. A newer LLVM "generic" CPU switches more on by default, and a
 * binary that needs reference types, multivalue, tail calls or relaxed SIMD
 * fails to compile in an older engine (or, for relaxed SIMD, computes
 * differently per engine and breaks the bit-exact goldens).
 *
 * This parses each binary's code and fails on any use of those features. It is
 * run by `check:wasm-abi` (and checkWasmBinary, so wasmAbiLock.test.ts covers
 * it) on the committed binaries and, in CI, the scalar reference too.
 *
 *   node scripts/check-wasm-features.mjs [binary ...]   # default: public/wasm/*.wasm
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { countOpcodes, readWasmModule } from './wasm-binary.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Features outside the allow-list that this binary uses. Empty = fine.
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function checkWasmFeatures(bytes) {
  const problems = [];
  const mod = readWasmModule(bytes);
  const ops = countOpcodes(mod);
  if (ops.reference_types > 0) problems.push(`uses reference types (${ops.reference_types} table/ref instruction(s))`);
  if (ops.tail_call > 0) problems.push(`uses tail calls (${ops.tail_call} return_call(_indirect))`);
  if (ops.relaxed_simd > 0) problems.push(`uses relaxed SIMD (${ops.relaxed_simd} instruction(s))`);
  const multiResult = mod.types.filter((t) => t.results.length > 1).length;
  if (multiResult > 0 || ops.multivalue_block > 0) {
    problems.push(`uses multivalue (${multiResult} multi-result function type(s), ${ops.multivalue_block} typed block(s))`);
  }
  if (mod.types.some((t) => [...t.params, ...t.results].some((v) => v === 'externref'))) {
    problems.push('uses externref in a function signature');
  }
  return problems;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const args = process.argv.slice(2);
  const targets = args.length
    ? args.map((a) => resolve(a))
    : readdirSync(join(repoRoot, 'public', 'wasm'))
        .filter((f) => f.endsWith('.wasm'))
        .map((f) => join(repoRoot, 'public', 'wasm', f));
  let failed = false;
  for (const path of targets) {
    const problems = checkWasmFeatures(readFileSync(path));
    const label = relative(repoRoot, path);
    if (problems.length) {
      failed = true;
      console.error(`❌ ${label} uses wasm features outside the pinned set:`);
      for (const p of problems) console.error(`   - ${p}`);
    } else {
      console.log(`✅ ${label}: only the pinned wasm features`);
    }
  }
  if (failed) process.exit(1);
}
