#!/usr/bin/env node
/**
 * SHA-256 of the C++ sources and build inputs every binary in public/wasm/ is
 * built from, recorded in public/wasm/streetview-wasm.wasm.sha256.
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
  'cpp/src/geodesy_module.cpp',
  'cpp/src/audio_module.cpp',
  'cpp/src/hrtf_module.cpp',
  'cpp/src/luma_module.cpp',
  'cpp/src/cabin_dsp_module.cpp',
  'cpp/src/depth_module.cpp',
  'cpp/src/graph_module.cpp',
  'cpp/src/runtime.cpp',
  'cpp/include/streetview/abi.h',
  'cpp/include/streetview/audio_kernels.h',
  'cpp/include/streetview/platform.h',
  'cpp/include/streetview/geodesy.h',
  'cpp/include/streetview/fft256.h',
  'cpp/include/streetview/simd.h',
  'cpp/CMakeLists.txt',
  // Build inputs, not just sources: the flags/scripts and the pinned emcc
  // decide the bytes as much as the C++ does.
  'cpp/emsdk.version',
  'scripts/build-wasm.sh',
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
