/**
 * src/wasm/__tests__/wasmAbiLock.test.ts
 *
 * Locks the WASM ABI across all four places it is declared:
 *
 *   1. cpp/src/streetview-wasm.wat      – canonical WAT source (`(export "…")`)
 *   2. cpp/src/bindings.cpp             – Emscripten C++ wrappers
 *   3. cpp/CMakeLists.txt               – EXPORTED_FUNCTIONS for the emcc link
 *   4. src/wasm/index.ts                – TypeScript loader (`exp['…']`)
 *
 * plus the committed binary in public/wasm. Adding an export to one of them and
 * forgetting the others is the failure mode this file exists to catch — the WAT
 * and Emscripten builds are produced by different toolchains (see
 * scripts/build-wasm.sh) and only one of them runs on any given machine, so
 * drift is otherwise invisible until runtime.
 */

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
] as const;

/** malloc/free come from the Emscripten runtime, not from our sources. */
const EMSCRIPTEN_RUNTIME_EXPORTS = new Set(['malloc', 'free']);

function sorted(names: Iterable<string>): string[] {
  return Array.from(names).sort();
}

const expectedSorted = sorted(EXPECTED_EXPORTS);

describe('WASM ABI lock', () => {
  it('WAT source exports exactly the expected set', () => {
    const wat = read('cpp', 'src', 'streetview-wasm.wat');
    const names = new Set<string>();
    // `(func (export "name")` — the memory export is matched too, so filter it.
    for (const match of wat.matchAll(/\(export\s+"([A-Za-z0-9_]+)"\)/g)) {
      const name = match[1]!;
      if (name !== 'memory') names.add(name);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('WAT source exports its linear memory (the loader needs it for buffer transfers)', () => {
    const wat = read('cpp', 'src', 'streetview-wasm.wat');
    expect(wat).toMatch(/\(memory\s+\(export\s+"memory"\)/);
  });

  it('bindings.cpp defines a wrapper for every export', () => {
    const bindings = read('cpp', 'src', 'bindings.cpp');
    const names = new Set<string>();
    // EMSCRIPTEN_KEEPALIVE followed by `<return type> name(`.
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
      // Emscripten prefixes C symbols with an underscore.
      expect(name.startsWith('_')).toBe(true);
      const stripped = name.slice(1);
      if (!EMSCRIPTEN_RUNTIME_EXPORTS.has(stripped)) names.add(stripped);
    }
    expect(sorted(names)).toEqual(expectedSorted);
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

  it('the committed binary exports exactly the expected set', async () => {
    const bytes = readFileSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'));
    const module = await WebAssembly.compile(bytes);
    const names = new Set<string>();
    for (const { name, kind } of WebAssembly.Module.exports(module)) {
      if (kind === 'function' && !EMSCRIPTEN_RUNTIME_EXPORTS.has(name)) names.add(name);
    }
    expect(sorted(names)).toEqual(expectedSorted);
  });

  it('the committed binary is not stale relative to the WAT source', async () => {
    const { createHash } = await import('crypto');
    const watSource = read('cpp', 'src', 'streetview-wasm.wat');
    const recorded = read('public', 'wasm', 'streetview-wasm.wasm.sha256').trim();
    const actual = createHash('sha256').update(watSource).digest('hex');
    // scripts/build-wasm.sh writes this hash; scripts/verify-build.sh checks the
    // same thing at build time. Run `npm run build:wasm` if this fails.
    expect(actual).toBe(recorded);
  });

  it('every API method on the TS wrapper is backed by a documented export', async () => {
    const { loadWasmModule, _resetWasmModule } = await import('../index');
    _resetWasmModule();
    const api = await loadWasmModule();
    // camelCase wrapper name → snake_case export name.
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
    };

    // The JS fallback must implement every method, so a missing binary never
    // turns into a runtime TypeError.
    for (const method of Object.keys(methodToExport)) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    // …and the mapping must cover the whole surface, minus the isWasm flag.
    const apiMethods = sorted(
      Object.keys(api).filter((key) => key !== 'isWasm'),
    );
    expect(apiMethods).toEqual(sorted(Object.keys(methodToExport)));
    expect(sorted(Object.values(methodToExport))).toEqual(expectedSorted);
    _resetWasmModule();
  });
});
