/**
 * src/wasm/__tests__/cabinDspParity.test.ts
 *
 * The cabin engine (dsp_*) and the fused luma chore (luma_analyze) on every
 * implementation, against the goldens scripts/gen-wasm-goldens.mjs captured
 * from the scalar binary:
 *
 *   - the JS twin (src/wasm/cabinDspTwin.ts via JS_FALLBACK),
 *   - public/wasm/streetview-wasm.wasm through the real loader wrappers,
 *   - public/wasm/streetview-wasm.simd.wasm (the AudioWorklet's binary,
 *     hand-vectorised FIR) through the same wrappers.
 *
 * All three must be bit-exact: same FNV-1a checksum over every rendered
 * sample, same excerpts. cpp/tests/cabin_dsp_test.cpp runs the same harness
 * on the host C++.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { instantiateStreetViewWasm, type StreetViewWasmAPI } from '../index';
import { JS_FALLBACK } from '../jsFallback';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const BLOCK = 128;

interface Keyframe {
  block: number;
  rpm: number;
  load: number;
  speedMps: number;
  openness: number;
  vehicle: number;
  wetRoad: number;
  rain: number;
  windMps: number;
  radioGain: number;
  wipers: number;
  ir?: { vehicle: number; openness: number } | null;
}

interface DspScript {
  label: string;
  sampleRate: number;
  irTaps: number;
  blocks: number;
  keyframes: Keyframe[];
  excerptBlocks: number[];
  expectedChecksum: number;
  expectedExcerpts: { block: number; left: number[]; right: number[] }[];
}

interface Goldens {
  cabinDsp: DspScript[];
  dspMaxIrTaps: number;
  lumaHistogram: { width: number; height: number; rgba: number[] };
  lumaAnalyze: { label: string; dstW: number; dstH: number; expectedBins: number[]; expectedStats: number[] }[];
}

const goldens = JSON.parse(
  readFileSync(join(REPO_ROOT, 'cpp', 'tests', 'goldens.json'), 'utf8'),
) as Goldens;

/** The golden harness's radio input (see scripts/gen-wasm-goldens.mjs). */
const radioSample = (k: number, ch: number): number =>
  Math.fround((((k % 2001) * 7919 + ch * 104729) % 2001 - 1000) / 2000);

function fnv1a(h: number, samples: Float32Array): number {
  const words = new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
  for (let i = 0; i < words.length; i++) {
    h ^= words[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

interface RunResult {
  checksum: number;
  excerpts: Map<number, { left: Float32Array; right: Float32Array }>;
}

/** Run a golden script; `chunks` splits each 128-frame block into renders of those sizes. */
function runScript(api: StreetViewWasmAPI, script: DspScript, chunks: number[] = [BLOCK]): RunResult {
  const dsp = api.createCabinDsp(script.sampleRate);
  if (!dsp) throw new Error('createCabinDsp returned null');
  const byBlock = new Map(script.keyframes.map((k) => [k.block, k]));
  const ir = new Float32Array(script.irTaps);
  const inL = new Float32Array(BLOCK);
  const inR = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const excerpts = new Map<number, { left: Float32Array; right: Float32Array }>();
  let checksum = 2166136261;
  let chunkIndex = 0;
  for (let b = 0; b < script.blocks; b++) {
    const k = byBlock.get(b);
    if (k) {
      dsp.setParams(k);
      if (k.ir === null) dsp.setIr(null);
      else if (k.ir) {
        api.fillCabinIr(ir, script.irTaps, k.ir.vehicle, k.ir.openness, script.sampleRate);
        dsp.setIr(ir);
      }
    }
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = radioSample(b * BLOCK + i, 0);
      inR[i] = radioSample(b * BLOCK + i, 1);
    }
    let done = 0;
    while (done < BLOCK) {
      const n = Math.min(chunks[chunkIndex++ % chunks.length]!, BLOCK - done);
      dsp.render(
        inL.subarray(done, done + n), inR.subarray(done, done + n),
        outL.subarray(done, done + n), outR.subarray(done, done + n), n,
      );
      done += n;
    }
    checksum = fnv1a(checksum, outL);
    checksum = fnv1a(checksum, outR);
    if (script.excerptBlocks.includes(b)) {
      excerpts.set(b, { left: outL.slice(), right: outR.slice() });
    }
  }
  dsp.destroy();
  return { checksum, excerpts };
}

function expectGolden(result: RunResult, script: DspScript): void {
  for (const e of script.expectedExcerpts) {
    const got = result.excerpts.get(e.block);
    expect(got, `${script.label} excerpt ${e.block}`).toBeDefined();
    // Compare as f32 bit patterns so -0 / +0 and the last ULP both count.
    const want = new Uint32Array(Float32Array.from(e.left).buffer);
    const wantR = new Uint32Array(Float32Array.from(e.right).buffer);
    expect(Array.from(new Uint32Array(got!.left.buffer)), `${script.label} L@${e.block}`).toEqual(Array.from(want));
    expect(Array.from(new Uint32Array(got!.right.buffer)), `${script.label} R@${e.block}`).toEqual(Array.from(wantR));
  }
  expect(result.checksum, `${script.label} checksum`).toBe(script.expectedChecksum);
}

const loadBinary = (file: string): Promise<StreetViewWasmAPI> =>
  instantiateStreetViewWasm(readFileSync(join(REPO_ROOT, 'public', 'wasm', file)));

describe('cabin DSP golden parity', () => {
  const backends: [string, () => Promise<StreetViewWasmAPI>][] = [
    ['JS twin', () => Promise.resolve(JS_FALLBACK)],
    ['scalar wasm', () => loadBinary('streetview-wasm.wasm')],
    ['SIMD wasm', () => loadBinary('streetview-wasm.simd.wasm')],
  ];

  for (const [name, load] of backends) {
    describe(name, () => {
      for (const script of goldens.cabinDsp) {
        it(`renders "${script.label}" bit-for-bit`, async () => {
          const api = await load();
          expectGolden(runScript(api, script), script);
        }, 60_000);
      }

      it('lumaAnalyze matches the goldens', async () => {
        const api = await load();
        const img = goldens.lumaHistogram;
        for (const c of goldens.lumaAnalyze) {
          const got = api.lumaAnalyze(Uint8Array.from(img.rgba), img.width, img.height, c.dstW, c.dstH);
          expect(Array.from(got.bins), c.label).toEqual(c.expectedBins);
          expect([got.mean, got.min, got.max], c.label).toEqual(c.expectedStats);
          expect(got.count).toBe(c.dstW * c.dstH);
        }
      });
    });
  }

  it('the twin does not care how a block is split', () => {
    const script = goldens.cabinDsp.find((s) => s.label === 'ir-swap-48k-2048')!;
    expectGolden(runScript(JS_FALLBACK, script, [37, 91]), script);
    expectGolden(runScript(JS_FALLBACK, script, [1, 3, 124]), script);
  });

  it('the wasm wrapper renders more than one quantum per call', async () => {
    const api = await loadBinary('streetview-wasm.wasm');
    const a = api.createCabinDsp(48000)!;
    const b = JS_FALLBACK.createCabinDsp(48000)!;
    const p = { rpm: 3000, load: 0.5, speedMps: 20, openness: 0.3, vehicle: 1, wetRoad: 0.5, rain: 0.4, windMps: 5, radioGain: 0, wipers: true };
    a.setParams(p);
    b.setParams(p);
    const la = new Float32Array(300);
    const lb = new Float32Array(300);
    a.render(null, null, la, null, 300);
    b.render(null, null, lb, null, 300);
    expect(Array.from(la)).toEqual(Array.from(lb));
    a.destroy();
    a.destroy(); // idempotent
    a.render(null, null, la, null, 128); // no-op after destroy
  });

  it('the IR ceiling is the same on every backend', async () => {
    expect(goldens.dspMaxIrTaps).toBe(4096);
    const { CABIN_DSP_MAX_IR_TAPS } = await import('../cabinDspTwin');
    expect(CABIN_DSP_MAX_IR_TAPS).toBe(goldens.dspMaxIrTaps);
  });
});
