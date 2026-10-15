#!/usr/bin/env node
/**
 * scripts/bench-cabin-dsp.mjs
 *
 * Time `dsp_render` per 128-frame render quantum on the two shipped binaries
 * (scalar and SIMD128) across cabin IR lengths, and report it as a share of
 * the quantum's real-time budget (128 / sampleRate). This is the number the
 * #321 acceptance criterion is about: an IR of >= 1024 taps must render in
 * <= 25 % of the quantum on the scalar binary. Results are recorded in
 * docs/WASM_BRIDGE.md.
 *
 *   node scripts/bench-cabin-dsp.mjs [--rate 48000] [--quanta 3000] [--check]
 *
 * --check exits non-zero when the scalar 1024-tap case is over 25 %. Timing is
 * machine-dependent, so this is a local / manual gate, not part of
 * `npm run verify`.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flagValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const sampleRate = flagValue('--rate', 48000);
const quanta = flagValue('--quanta', 3000);
const check = argv.includes('--check');
const QUANTUM = 128;
const TAPS = [128, 1024, 2048, 4096];
const budgetMs = (QUANTUM / sampleRate) * 1000;

async function load(file) {
  const bytes = readFileSync(join(repoRoot, 'public', 'wasm', file));
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const exp = instance.exports;
  if (typeof exp._initialize === 'function') exp._initialize();
  return exp;
}

function bench(exp, taps) {
  const state = exp.dsp_create(sampleRate);
  const io = exp.malloc(QUANTUM * 4 * 4);
  const ir = exp.malloc(taps * 4);
  exp.fill_cabin_ir(ir, taps, 3, 0, sampleRate);
  exp.dsp_set_ir(state, ir, taps);
  // Everything audible at once: a wet, rainy, windy cruise with the radio on.
  exp.dsp_set_params(state, 2600, 0.35, 25, 0.5, 3, 1, 0.8, 10, 0.8, 1);
  const inL = io;
  const inR = io + QUANTUM * 4;
  const outL = inR + QUANTUM * 4;
  const outR = outL + QUANTUM * 4;
  const l = new Float32Array(exp.memory.buffer, inL, QUANTUM);
  const r = new Float32Array(exp.memory.buffer, inR, QUANTUM);
  for (let i = 0; i < QUANTUM; i++) {
    l[i] = Math.sin(i * 0.05) * 0.3;
    r[i] = Math.cos(i * 0.07) * 0.3;
  }
  // Warm up past the IR crossfade and the JIT tiers.
  for (let q = 0; q < 400; q++) exp.dsp_render(state, inL, inR, outL, outR, QUANTUM);
  const t0 = performance.now();
  for (let q = 0; q < quanta; q++) exp.dsp_render(state, inL, inR, outL, outR, QUANTUM);
  const perQuantum = (performance.now() - t0) / quanta;
  exp.free(ir);
  exp.free(io);
  exp.dsp_destroy(state);
  return perQuantum;
}

const scalar = await load('streetview-wasm.wasm');
const simd = await load('streetview-wasm.simd.wasm');

console.log(`dsp_render, ${QUANTUM}-frame quantum at ${sampleRate} Hz (budget ${budgetMs.toFixed(3)} ms), node ${process.version}`);
console.log('taps   scalar ms (budget)   simd ms (budget)   speed-up');
let failed = false;
for (const taps of TAPS) {
  const a = bench(scalar, taps);
  const b = bench(simd, taps);
  const pa = (a / budgetMs) * 100;
  const pb = (b / budgetMs) * 100;
  console.log(
    `${String(taps).padStart(4)}   ${a.toFixed(4)} (${pa.toFixed(1).padStart(5)} %)    `
    + `${b.toFixed(4)} (${pb.toFixed(1).padStart(5)} %)   ${(a / b).toFixed(2)}x`,
  );
  if (taps === 1024 && pa > 25) failed = true;
}
if (check && failed) {
  console.error('❌ scalar 1024-tap render is over 25 % of the quantum budget');
  process.exit(1);
}
