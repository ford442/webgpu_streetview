/**
 * src/wasm/__tests__/wasmAbiLock.test.ts
 *
 * Locks the WASM ABI across the places it is declared:
 *
 *   1. cpp/src/bindings.cpp             – Emscripten C++ wrappers
 *   2. cpp/CMakeLists.txt               – EXPORTED_FUNCTIONS for the emcc link
 *   3. src/wasm/index.ts                – TypeScript loader (`exp['…']`)
 *   4. cpp/include/streetview_wasm.h    – sw_* twins of the exported names
 *
 * plus the committed binary in public/wasm and the C++ source hash that
 * scripts/verify-build.sh checks. Adding an export to one of them and
 * forgetting the others is the failure mode this file exists to catch.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const read = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), 'utf8');

/** The ABI. Every list below must agree with this, in this exact set. */
const EXPECTED_EXPORTS = [
  'seed',
  'noise2d',
  'fill_noise_buffer',
  'fbm2d',
  'fill_fbm_buffer',
  'fill_particle_seeds',
  'normalize_angle',
  'signed_angle_diff',
  'haversine',
  'batch_haversine',
  'fill_engine_noise',
  'luma_histogram_bt709',
  'reduce_luma_bt709',
  'downsample_2d',
] as const;

/** Emscripten runtime / STANDALONE_WASM helpers — not part of our ABI. */
const EMSCRIPTEN_RUNTIME_EXPORTS = new Set([
  'malloc',
  'free',
  '_initialize',
  '_emscripten_stack_restore',
  'emscripten_stack_get_current',
]);

function sorted(names: Iterable<string>): string[] {
  return Array.from(names).sort();
}

const expectedSorted = sorted(EXPECTED_EXPORTS);

describe('WASM ABI lock', () => {
  it('bindings.cpp defines a wrapper for every export', () => {
    const bindings = read('cpp', 'src', 'bindings.cpp');
    const names = new Set<string>();
    for (const match of bindings.matchAll(
      /EMSCRIPTEN_KEEPALIVE\s+[A-Za-z_][A-Za-z0-9_*\s]*?\s([A-Za-z0-9_]+)\s*\(/g,
    )) {
      names.add(match[1]!);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('CMake EXPORTED_FUNCTIONS matches the expected set', () => {
    const cmake = read('cpp', 'CMakeLists.txt');
    const listMatch = cmake.match(/EXPORTED_FUNCTIONS=\[([^\]]*)\]/);
    expect(listMatch).not.toBeNull();
    const names = new Set<string>();
    for (const raw of listMatch![1]!.split(',')) {
      const name = raw.trim().replace(/^'|'$/g, '');
      if (!name) continue;
      expect(name.startsWith('_')).toBe(true);
      const stripped = name.slice(1);
      if (!EMSCRIPTEN_RUNTIME_EXPORTS.has(stripped)) names.add(stripped);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('streetview_wasm.h declares a sw_* twin for every export', () => {
    const header = read('cpp', 'include', 'streetview_wasm.h');
    const declared = new Set<string>();
    for (const match of header.matchAll(/\bsw_([A-Za-z0-9_]+)\s*\(/g)) {
      declared.add(match[1]!);
    }
    expect(sorted(declared)).toEqual(expectedSorted);
  });

  it('the TypeScript loader reads exactly the expected exports', () => {
    const loader = read('src', 'wasm', 'index.ts');
    const names = new Set<string>();
    for (const match of loader.matchAll(/exp\['([A-Za-z0-9_]+)'\]/g)) {
      const name = match[1]!;
      if (name !== 'memory') names.add(name);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('the committed binary exports every expected function (runtime extras allowed)', async () => {
    const bytes = readFileSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'));
    const module = await WebAssembly.compile(bytes);
    const names = new Set<string>();
    for (const { name, kind } of WebAssembly.Module.exports(module)) {
      if (kind === 'function' && !EMSCRIPTEN_RUNTIME_EXPORTS.has(name)) names.add(name);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('the committed binary is not stale relative to the C++ sources', () => {
    const recorded = read('public', 'wasm', 'streetview-wasm.wasm.sha256').trim();
    const actual = execFileSync('node', ['scripts/wasm-source-hash.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    expect(actual).toBe(recorded);
  });

  it('the committed binary SHA-256 matches the goldens record', () => {
    const bytes = readFileSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const goldens = JSON.parse(read('cpp', 'tests', 'goldens.json')) as { wasmSha256: string };
    expect(sha).toBe(goldens.wasmSha256);
  });

  it('every API method on the TS wrapper is backed by a documented export', async () => {
    const { loadWasmModule, _resetWasmModule } = await import('../index');
    _resetWasmModule();
    const api = await loadWasmModule();
    const methodToExport: Record<string, string> = {
      seed: 'seed',
      noise2d: 'noise2d',
      fillNoiseBuffer: 'fill_noise_buffer',
      fbm2d: 'fbm2d',
      fillFbmBuffer: 'fill_fbm_buffer',
      fillParticleSeeds: 'fill_particle_seeds',
      normalizeAngle: 'normalize_angle',
      signedAngleDiff: 'signed_angle_diff',
      haversine: 'haversine',
      batchHaversine: 'batch_haversine',
      fillEngineNoise: 'fill_engine_noise',
      lumaHistogramBt709: 'luma_histogram_bt709',
      reduceLumaBt709: 'reduce_luma_bt709',
      downsample2d: 'downsample_2d',
    };

    for (const method of Object.keys(methodToExport)) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    const apiMethods = sorted(
      Object.keys(api).filter((key) => key !== 'isWasm'),
    );
    expect(apiMethods).toEqual(sorted(Object.keys(methodToExport)));
    expect(sorted(Object.values(methodToExport))).toEqual(expectedSorted);
    _resetWasmModule();
  });
});
