#!/usr/bin/env node
/**
 * scripts/check-wasm-abi.mjs
 *
 * Verify that public/wasm/streetview-wasm.wasm (scalar) and
 * public/wasm/streetview-wasm.simd.wasm (SIMD128, the AudioWorklet's cabin DSP)
 * both export every function declared by the C++ ABI wrappers in
 * cpp/src/bindings.cpp. The TypeScript loader
 * (src/wasm/index.ts) reads exactly those names; a missing wrapper or a
 * forgotten EXPORTED_FUNCTIONS entry would otherwise only show up as a silent
 * JS-fallback at runtime.
 *
 *   npm run build:wasm
 *   node scripts/check-wasm-abi.mjs
 *
 * Source-level drift (bindings vs CMake vs TS loader) is covered by
 * src/wasm/__tests__/wasmAbiLock.test.ts.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bindingsPath = join(repoRoot, 'cpp', 'src', 'bindings.cpp');
const wasmPaths = [
  join(repoRoot, 'public', 'wasm', 'streetview-wasm.wasm'),
  join(repoRoot, 'public', 'wasm', 'streetview-wasm.simd.wasm'),
];

const bindings = readFileSync(bindingsPath, 'utf8');
const expected = new Set();
for (const match of bindings.matchAll(
  /EMSCRIPTEN_KEEPALIVE\s+[A-Za-z_][A-Za-z0-9_*\s]*?\s([A-Za-z0-9_]+)\s*\(/g,
)) {
  expected.add(match[1]);
}

if (expected.size === 0) {
  console.error(`❌ No EMSCRIPTEN_KEEPALIVE exports found in ${bindingsPath}.`);
  process.exit(1);
}

for (const wasmPath of wasmPaths) {
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

  if (missing.length > 0) {
    console.error(`❌ WASM ABI drift — ${wasmPath} is missing exports declared in bindings.cpp:`);
    for (const name of missing) console.error(`   - ${name}`);
    console.error('\n   Add the wrapper in cpp/src/bindings.cpp and the "_name" entry in');
    console.error('   cpp/CMakeLists.txt EXPORTED_FUNCTIONS, then rebuild.');
    process.exit(1);
  }

  if (!exportsMemory) {
    console.error(`❌ ${wasmPath} does not export "memory"; the loader cannot transfer buffers.`);
    process.exit(1);
  }
  console.log(`✅ ${wasmPath.slice(repoRoot.length + 1)}: ${expected.size} exports present, memory exported.`);
}

for (const name of [...expected].sort()) console.log(`   - ${name}`);
