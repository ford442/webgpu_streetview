/**
 * src/wasm/__tests__/wasmAbiLock.test.ts
 *
 * Locks the WASM ABI to its one source, cpp/include/streetview/abi.h
 * (`SV_EXPORT(name)` on every declaration):
 *
 *   - src/wasm/abi.generated.ts is what scripts/gen-wasm-abi.mjs makes of it
 *     now (a param type changed without `npm run gen:wasm-abi` fails here);
 *   - each committed binary's *type section* carries exactly those
 *     signatures (scripts/check-wasm-abi.mjs — a C++ change without a rebuild
 *     fails here), and the worklet binary has no memory.grow, no imports and
 *     fits its 32 KB budget;
 *   - the loader binds every export through the table (bindExports.ts), and
 *     every TS API method is backed by one;
 *   - the source hash, the goldens' binary SHA and the stack size agree with
 *     CMake.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkWasmBinary, DSP_MAX_BYTES } from '../../../scripts/check-wasm-abi.mjs';
import { ABI_GENERATED, ABI_HEADER, generateAbiModule, parseAbiHeader } from '../../../scripts/gen-wasm-abi.mjs';
import { WASM_SOURCE_FILES } from '../../../scripts/wasm-source-hash.mjs';
import { WASM_ABI, DSP_EXPORT_NAMES } from '../abi.generated';
import { abiExportNames, bindWasmExports } from '../bindExports';

const REPO_ROOT = join(__dirname, '..', '..', '..');

const read = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), 'utf8');
const binary = (file: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(REPO_ROOT, 'public', 'wasm', file)));

const sorted = (names: Iterable<string>): string[] => Array.from(names).sort();

/** The translation units CMake lists for a target (`set(NAME ...)`). */
function cmakeList(name: string): string[] {
  const body = read('cpp', 'CMakeLists.txt').match(new RegExp(`set\\(${name}\\s+([^)]*)\\)`))?.[1] ?? '';
  return body.split(/\s+/).filter((s) => s.endsWith('.cpp'));
}

describe('WASM ABI lock', () => {
  it('abi.generated.ts is current with abi.h (npm run gen:wasm-abi)', () => {
    expect(read(ABI_GENERATED)).toBe(generateAbiModule(REPO_ROOT));
  });

  it('a param type changed in abi.h without regenerating is caught twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abi-lock-'));
    try {
      cpSync(join(REPO_ROOT, 'cpp', 'include'), join(dir, 'cpp', 'include'), { recursive: true });
      cpSync(join(REPO_ROOT, 'cpp', 'src'), join(dir, 'cpp', 'src'), { recursive: true });
      cpSync(join(REPO_ROOT, 'cpp', 'CMakeLists.txt'), join(dir, 'cpp', 'CMakeLists.txt'));
      const header = read(ABI_HEADER);
      const narrowed = header.replace('double phase, double sample_index', 'float phase, double sample_index');
      expect(narrowed).not.toBe(header);
      writeFileSync(join(dir, ABI_HEADER), narrowed);
      // The committed table no longer matches what the generator makes…
      expect(generateAbiModule(dir)).not.toBe(read(ABI_GENERATED));
      // …and the committed binary's type section no longer matches abi.h.
      const problems = checkWasmBinary(binary('streetview-wasm.simd.wasm'), 'main', parseAbiHeader(dir));
      expect(problems.join('\n')).toMatch(/fill_engine_noise: binary .* ≠ abi\.h/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the shipped main binary matches abi.h signature for signature', () => {
    expect(checkWasmBinary(binary('streetview-wasm.simd.wasm'), 'main', parseAbiHeader(REPO_ROOT))).toEqual([]);
  });

  it(`the worklet binary matches abi.h, never grows memory, imports nothing and is < ${DSP_MAX_BYTES} B`, () => {
    const bytes = binary('streetview-dsp.simd.wasm');
    expect(checkWasmBinary(bytes, 'dsp', parseAbiHeader(REPO_ROOT))).toEqual([]);
    expect(bytes.length).toBeLessThan(DSP_MAX_BYTES);
  });

  it('the scalar build is a CI oracle only: it is not committed', () => {
    expect(existsSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'))).toBe(false);
  });

  it('the worklet binary exports exactly the dsp_* engine and the runtime', () => {
    expect(sorted(DSP_EXPORT_NAMES)).toEqual(sorted(abiExportNames('dsp')));
    for (const name of DSP_EXPORT_NAMES) {
      expect(name.startsWith('dsp_') || name.startsWith('sv_')).toBe(true);
    }
  });

  it('every export is defined in a TU CMake links (and only dsp TUs reach the worklet)', () => {
    const main = cmakeList('STREETVIEW_SOURCES');
    const dsp = cmakeList('STREETVIEW_DSP_SOURCES');
    expect(main.length).toBeGreaterThan(1);
    expect(dsp.length).toBeGreaterThan(0);
    for (const e of parseAbiHeader(REPO_ROOT)) {
      expect(main.some((tu) => tu.endsWith(e.unit)), e.name).toBe(true);
      expect(e.binaries.includes('dsp'), e.name).toBe(dsp.some((tu) => tu.endsWith(e.unit)));
    }
  });

  it('the source hash covers every TU and every streetview/ header', () => {
    const units = cmakeList('STREETVIEW_SOURCES').map((tu) => tu.replace(/^.*src\//, 'cpp/src/'));
    for (const tu of units) expect(WASM_SOURCE_FILES).toContain(tu);
    for (const header of ['abi.h', 'platform.h', 'geodesy.h', 'audio_kernels.h', 'fft256.h', 'simd.h']) {
      expect(WASM_SOURCE_FILES).toContain(`cpp/include/streetview/${header}`);
    }
  });

  it('the loader binds the main binary through the table, arity included', async () => {
    const { instance } = await WebAssembly.instantiate(binary('streetview-wasm.simd.wasm'), {
      env: { emscripten_notify_memory_growth: () => {} },
    });
    const { fns } = bindWasmExports(instance.exports, 'main');
    expect(sorted(Object.keys(fns))).toEqual(sorted(abiExportNames('main')));
    // A wrong arity is refused at load, in every browser.
    const tampered = { ...instance.exports, dsp_set_ir: (a: number, b: number) => a + b };
    expect(() => bindWasmExports(tampered, 'main')).toThrow(/dsp_set_ir takes 2 params, abi\.h declares 3/);
  });

  it('fill_engine_noise keeps the f64 phase signature', () => {
    // Bug 2 was an f32 absolute-time argument; narrowing the phase or the
    // sample index back to float must fail loudly here.
    expect(WASM_ABI.fill_engine_noise.params.slice(5, 7)).toEqual(['f64', 'f64']);
    expect(WASM_ABI.fill_engine_noise.results).toEqual(['f64']);
  });

  it('the loader expects the stack size CMake pins for the main binary', async () => {
    const cmake = read('cpp', 'CMakeLists.txt');
    const pinned = Number(cmake.match(/-sSTACK_SIZE=(\d+)/)?.[1]);
    const { WASM_STACK_SIZE } = await import('../marshal');
    expect(pinned).toBe(WASM_STACK_SIZE);
  });

  it('the committed binaries are not stale relative to the C++ sources', () => {
    const recorded = read('public', 'wasm', 'streetview-wasm.wasm.sha256').trim();
    const actual = execFileSync('node', ['scripts/wasm-source-hash.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    expect(actual).toBe(recorded);
  });

  it('the goldens were captured from the committed main binary', () => {
    const sha = createHash('sha256').update(binary('streetview-wasm.simd.wasm')).digest('hex');
    const goldens = JSON.parse(read('cpp', 'tests', 'goldens.json')) as { wasmSha256: string };
    expect(sha).toBe(goldens.wasmSha256);
  });

  it('every API method on the TS wrapper is backed by an export', async () => {
    const { loadWasmModule } = await import('../index');
    const api = await loadWasmModule();
    // createCabinDsp wraps the whole dsp_* family behind one instance object.
    const methodToExport: Record<string, readonly string[]> = {
      seed: ['seed'],
      noise2d: ['noise2d'],
      fillNoiseBuffer: ['fill_noise_buffer'],
      fbm2d: ['fbm2d'],
      fillFbmBuffer: ['fill_fbm_buffer'],
      fillParticleSeeds: ['fill_particle_seeds'],
      batchHaversine: ['batch_haversine'],
      offsetLatLng: ['offset_latlng'],
      initialBearing: ['initial_bearing'],
      polylineResample: ['polyline_resample'],
      polylineProject: ['polyline_project'],
      fillEngineNoise: ['fill_engine_noise'],
      fillCabinIr: ['fill_cabin_ir'],
      fillHrtf: ['fill_hrtf'],
      lumaHistogramBt709: ['luma_histogram_bt709'],
      reduceLumaBt709: ['reduce_luma_bt709'],
      downsample2d: ['downsample_2d'],
      lumaAnalyze: ['luma_analyze'],
      createCabinDsp: [
        'dsp_create', 'dsp_destroy', 'dsp_set_params', 'dsp_set_ir', 'dsp_render', 'dsp_max_ir_taps',
      ],
      depthPercentiles: ['depth_percentiles'],
      depthNearDepth: ['depth_near_depth'],
      depthNormalize: ['depth_normalize'],
      graphAstar: ['graph_astar'],
      graphNearest: ['graph_nearest'],
    };

    for (const method of Object.keys(methodToExport)) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    expect(sorted(Object.keys(api))).toEqual(sorted(Object.keys(methodToExport)));
    const runtime = abiExportNames('main').filter((name) => name.startsWith('sv_'));
    expect(sorted([...Object.values(methodToExport).flat(), ...runtime])).toEqual(sorted(abiExportNames('main')));
  });
});
