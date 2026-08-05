#!/usr/bin/env node
/**
 * scripts/check-wasm-abi.mjs
 *
 * Verify that a built public/wasm/streetview-wasm.wasm exports everything the
 * canonical WAT source declares. The WAT source is the ABI of record: the
 * TypeScript loader (src/wasm/index.ts) reads exactly those names, so a C++ /
 * Emscripten build that is missing one silently falls back to the JS path at
 * runtime instead of failing loudly.
 *
 * Run after either build path:
 *   npm run build:wasm            # WAT  → wasm
 *   npm run build:wasm:emscripten # C++  → wasm
 *   node scripts/check-wasm-abi.mjs
 *
 * The equivalent source-level check (WAT vs bindings.cpp vs CMakeLists.txt vs
 * the TS loader) lives in src/wasm/__tests__/wasmAbiLock.test.ts and runs with
 * the normal test suite; this script covers the compiled artifact, which only
 * one of the two toolchains produces on any given machine.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const watPath = join(repoRoot, 'cpp', 'src', 'streetview-wasm.wat');
const wasmPath = join(repoRoot, 'public', 'wasm', 'streetview-wasm.wasm');

const wat = readFileSync(watPath, 'utf8');
const expected = new Set(
  [...wat.matchAll(/\(export\s+"([A-Za-z0-9_]+)"\)/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'memory'),
);

if (expected.size === 0) {
  console.error(`❌ No exports found in ${watPath} — the ABI source looks wrong.`);
  process.exit(1);
}

const module = await WebAssembly.compile(readFileSync(wasmPath));
const actualFunctions = new Set(
  WebAssembly.Module.exports(module)
    .filter((e) => e.kind === 'function')
    .map((e) => e.name),
);
const exportsMemory = WebAssembly.Module.exports(module).some(
  (e) => e.name === 'memory' && e.kind === 'memory',
);

const missing = [...expected].filter((name) => !actualFunctions.has(name)).sort();

// Extra exports are fine (Emscripten adds malloc/free and runtime helpers);
// missing ones are not.
if (missing.length > 0) {
  console.error('❌ WASM ABI drift — the built binary is missing exports declared in the WAT source:');
  for (const name of missing) console.error(`   - ${name}`);
  console.error('\n   Add the wrapper in cpp/src/bindings.cpp and the "_name" entry in');
  console.error('   cpp/CMakeLists.txt EXPORTED_FUNCTIONS, then rebuild.');
  process.exit(1);
}

if (!exportsMemory) {
  console.error('❌ The built binary does not export "memory"; the loader cannot transfer buffers.');
  process.exit(1);
}

console.log(`✅ WASM ABI OK — ${expected.size} exports present, memory exported.`);
for (const name of [...expected].sort()) console.log(`   - ${name}`);
