#!/usr/bin/env node
/**
 * scripts/check-wasm-abi.mjs
 *
 * Lock the binaries to the ABI by *signature*, not just by name. Every
 * `SV_EXPORT` in cpp/include/streetview/abi.h (parsed by gen-wasm-abi.mjs,
 * the same table src/wasm/abi.generated.ts is generated from) must be exported
 * by each binary that links its TU, with exactly the param/result types the
 * binary's type section declares — a changed parameter type or arity fails
 * here, not at runtime. A binary may not export ABI-looking functions the
 * header does not declare.
 *
 * The worklet binary (streetview-dsp.simd.wasm) must also have no memory.grow
 * instruction and no imports (the real-time thread can never grow memory),
 * and stay under 32 KB.
 *
 *   node scripts/check-wasm-abi.mjs                     # public/wasm/*
 *   node scripts/check-wasm-abi.mjs --main <path> ...   # extra main-kind binary
 *                                                       # (CI: the scalar reference)
 */

import { readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseAbiHeader } from './gen-wasm-abi.mjs';
import { countOpcodes, exportSignatures, formatSignature, readWasmModule } from './wasm-binary.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Exports emcc adds to every STANDALONE_WASM reactor; not part of the ABI. */
export const RUNTIME_EXTRAS = new Set([
  '_initialize',
  '_emscripten_stack_restore',
  'emscripten_stack_get_current',
]);

export const DSP_MAX_BYTES = 32 * 1024;

/**
 * Check one binary against the ABI. Returns a list of problems (empty = ok).
 * @param {Uint8Array} bytes
 * @param {'main' | 'dsp'} kind
 * @param {ReturnType<typeof parseAbiHeader>} abi
 * @returns {string[]}
 */
export function checkWasmBinary(bytes, kind, abi) {
  const problems = [];
  const mod = readWasmModule(bytes);
  const actual = exportSignatures(mod);
  const expected = abi.filter((e) => e.binaries.includes(kind));
  for (const e of expected) {
    const sig = actual.get(e.name);
    const want = { params: e.params.map((p) => p.wasm), results: e.result ? [e.result] : [] };
    if (!sig) {
      problems.push(`missing export ${e.name} ${formatSignature(want)}`);
    } else if (formatSignature(sig) !== formatSignature(want)) {
      problems.push(`${e.name}: binary ${formatSignature(sig)} ≠ abi.h ${formatSignature(want)}`);
    }
  }
  const declared = new Set(expected.map((e) => e.name));
  for (const name of actual.keys()) {
    if (!declared.has(name) && !RUNTIME_EXTRAS.has(name)) {
      problems.push(`unexpected export ${name} (not an SV_EXPORT of a TU this binary links)`);
    }
  }
  if (!mod.exports.some((e) => e.name === 'memory' && e.kind === 2)) {
    problems.push('does not export "memory"; the loader cannot transfer buffers');
  }
  if (kind === 'dsp') {
    const ops = countOpcodes(mod);
    if (ops['memory.grow'] !== 0) problems.push(`has ${ops['memory.grow']} memory.grow instruction(s)`);
    if (mod.importedFuncs.length !== 0) {
      problems.push(`imports ${mod.importedFuncs.map((i) => `${i.module}.${i.name}`).join(', ')}`);
    }
    if (bytes.length >= DSP_MAX_BYTES) problems.push(`is ${bytes.length} B (budget < ${DSP_MAX_BYTES})`);
  }
  return problems;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const abi = parseAbiHeader(repoRoot);
  /** @type {[string, 'main' | 'dsp'][]} */
  const targets = [
    [join(repoRoot, 'public', 'wasm', 'streetview-wasm.simd.wasm'), 'main'],
    [join(repoRoot, 'public', 'wasm', 'streetview-dsp.simd.wasm'), 'dsp'],
  ];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--main' || flag === '--dsp') targets.push([resolve(argv[++i] ?? ''), flag === '--main' ? 'main' : 'dsp']);
  }
  let failed = false;
  for (const [path, kind] of targets) {
    const bytes = readFileSync(path);
    const problems = checkWasmBinary(bytes, kind, abi);
    const label = relative(repoRoot, path);
    if (problems.length > 0) {
      failed = true;
      console.error(`❌ ${label} (${kind}) drifted from cpp/include/streetview/abi.h:`);
      for (const p of problems) console.error(`   - ${p}`);
    } else {
      const n = abi.filter((e) => e.binaries.includes(kind)).length;
      console.log(`✅ ${label}: ${n} exports match abi.h by signature (${bytes.length} B)`);
    }
  }
  if (failed) {
    console.error('\n   Change abi.h, run npm run gen:wasm-abi, rebuild (npm run build:wasm:update).');
    process.exit(1);
  }
}
