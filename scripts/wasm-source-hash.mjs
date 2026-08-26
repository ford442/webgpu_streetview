#!/usr/bin/env node
/**
 * SHA-256 of the C++ inputs that produce public/wasm/streetview-wasm.wasm.
 * Used by scripts/build-wasm.sh and scripts/verify-build.sh so a C++ edit
 * without a wasm rebuild fails loudly. Not a hash of the WAT text.
 *
 *   node scripts/wasm-source-hash.mjs
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const WASM_SOURCE_FILES = [
  'cpp/src/noise_module.cpp',
  'cpp/src/bindings.cpp',
  'cpp/include/streetview_wasm.h',
  'cpp/CMakeLists.txt',
];

export function wasmSourceHash(repoRoot) {
  const hash = createHash('sha256');
  for (const rel of WASM_SOURCE_FILES) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(repoRoot, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const thisFile = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === thisFile) {
  process.stdout.write(`${wasmSourceHash(repoRoot)}\n`);
}
