#!/usr/bin/env node
/**
 * scripts/bench-cabin-dsp.mjs
 *
 * Time `dsp_render` per 128-frame render quantum on the worklet binary
 * (public/wasm/streetview-dsp.simd.wasm) across cabin IR lengths: steady
 * state, the quanta right after an IR swap (the direct partition's glide), and
 * `dsp_set_ir` itself — as ms and as a share of the quantum's real-time budget
 * (128 / sampleRate). With --before <binary> the same runs on an older build
 * (any binary exporting dsp_*; e.g. the pre-#341 direct-form FIR) and the
 * ratio is printed: #341's criterion is >= 8x fewer cycles per quantum at
 * 2048 taps, and a swap costing no more than steady state. Results are
 * recorded in WASM.md.
 *
 *   node scripts/bench-cabin-dsp.mjs [--rate 48000] [--quanta 3000] [--before old.wasm] [--check]
 *
 * --check exits non-zero when 2048 taps is over 10 % of the quantum. Timing is
 * machine-dependent, so this is a local / manual gate, not part of
 * `npm run verify`.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const sampleRate = Number(flag('--rate', 48000));
const quanta = Number(flag('--quanta', 3000));
const beforePath = flag('--before', null);
const afterPath = flag('--after', join(repoRoot, 'public', 'wasm', 'streetview-dsp.simd.wasm'));
const check = argv.includes('--check');
const QUANTUM = 128;
const TAPS = [128, 1024, 2048, 4096, 8192, 16384];
const SWAP_QUANTA = 8; // the glide: 1024 frames
const budgetMs = (QUANTUM / sampleRate) * 1000;

async function load(path) {
  const bytes = readFileSync(resolve(path));
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const exp = instance.exports;
  if (typeof exp._initialize === 'function') exp._initialize();
  return {
    exp,
    malloc: exp.sv_malloc ?? exp.malloc,
    free: exp.sv_free ?? exp.free,
    maxTaps: exp.dsp_max_ir_taps(),
  };
}

// IRs come from the main binary's fill_cabin_ir (the worklet binary has no
// cold kernels): the limousine, roof up and down.
const main = await load(join(repoRoot, 'public', 'wasm', 'streetview-wasm.simd.wasm'));
function cabinIr(taps, openness) {
  const ptr = main.malloc(taps * 4);
  main.exp.fill_cabin_ir(ptr, taps, 3, openness, sampleRate);
  const out = new Float32Array(main.exp.memory.buffer, ptr, taps).slice();
  main.free(ptr);
  return out;
}

function bench(bin, taps) {
  const { exp } = bin;
  const n = Math.min(taps, bin.maxTaps);
  const state = exp.dsp_create(sampleRate);
  const io = bin.malloc(QUANTUM * 4 * 4 + n * 4);
  const inL = io;
  const inR = io + QUANTUM * 4;
  const outL = inR + QUANTUM * 4;
  const outR = outL + QUANTUM * 4;
  const irOff = outR + QUANTUM * 4;
  const irs = [cabinIr(n, 0), cabinIr(n, 1)];
  const setIr = (which) => {
    new Float32Array(exp.memory.buffer, irOff, n).set(irs[which]);
    exp.dsp_set_ir(state, irOff, n);
  };
  setIr(0);
  // Everything audible at once: a wet, rainy, windy cruise with the radio on.
  exp.dsp_set_params(state, 2600, 0.35, 25, 0.5, 3, 1, 0.8, 10, 0.8, 1);
  const l = new Float32Array(exp.memory.buffer, inL, QUANTUM);
  const r = new Float32Array(exp.memory.buffer, inR, QUANTUM);
  for (let i = 0; i < QUANTUM; i++) {
    l[i] = Math.sin(i * 0.05) * 0.3;
    r[i] = Math.cos(i * 0.07) * 0.3;
  }
  const render = () => exp.dsp_render(state, inL, inR, outL, outR, QUANTUM);
  // Warm up past the first glide and the JIT tiers.
  for (let q = 0; q < 400; q++) render();
  let t0 = performance.now();
  for (let q = 0; q < quanta; q++) render();
  const steady = (performance.now() - t0) / quanta;

  // Swap every 32 quanta; time the SWAP_QUANTA renders after each swap, and
  // the swap call itself, separately.
  let swapMs = 0;
  let setIrMs = 0;
  let swaps = 0;
  for (let q = 0; q < quanta; q += 32, swaps++) {
    t0 = performance.now();
    setIr((swaps + 1) & 1);
    const t1 = performance.now();
    for (let k = 0; k < SWAP_QUANTA; k++) render();
    swapMs += performance.now() - t1;
    setIrMs += t1 - t0;
    for (let k = SWAP_QUANTA; k < 32; k++) render();
  }
  bin.free(io);
  exp.dsp_destroy(state);
  return { steady, swap: swapMs / (swaps * SWAP_QUANTA), setIr: setIrMs / swaps };
}

const pct = (ms) => `${((ms / budgetMs) * 100).toFixed(1).padStart(5)} %`;
const after = await load(afterPath);
const before = beforePath ? await load(beforePath) : null;

console.log(`dsp_render, ${QUANTUM}-frame quantum at ${sampleRate} Hz (budget ${budgetMs.toFixed(3)} ms), node ${process.version}`);
console.log(`after:  ${afterPath}${before ? `\nbefore: ${beforePath}` : ''}`);
console.log('taps    steady ms (budget)   swap quanta ms (x steady)   set_ir ms'
  + (before ? '   before: steady ms (budget)  swap quanta ms   steady speed-up' : ''));
let failed = false;
for (const taps of TAPS) {
  const a = bench(after, taps);
  let line = `${String(taps).padStart(5)}   ${a.steady.toFixed(4)} (${pct(a.steady)})   `
    + `${a.swap.toFixed(4)} (${(a.swap / a.steady).toFixed(2)}x)            ${a.setIr.toFixed(4)}`;
  if (before && taps <= before.maxTaps) {
    const b = bench(before, taps);
    line += `      ${b.steady.toFixed(4)} (${pct(b.steady)})    ${b.swap.toFixed(4)}         `
      + `${(b.steady / a.steady).toFixed(1)}x`;
  }
  console.log(line);
  if (taps === 2048 && (a.steady / budgetMs) * 100 > 10) failed = true;
}
if (check && failed) {
  console.error('❌ the 2048-tap render is over 10 % of the quantum budget');
  process.exit(1);
}
