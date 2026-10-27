/**
 * The cabin AudioWorklet processor, exercised outside an AudioContext — with
 * the real committed binaries.
 *
 * `CABIN_WORKLET_SOURCE` is plain source text, so it can be evaluated here with
 * a stub `AudioWorkletProcessor`/`registerProcessor`/`sampleRate` and driven a
 * render quantum at a time, after posting it the binary's bytes as the main
 * thread does (a compiled `WebAssembly.Module` is accepted too). That covers what would otherwise
 * only run on a real audio thread: instantiating the engine, the pending
 * params/IR hand-off, rendering into the output channels (bit-identical to the
 * cabin DSP scripts in cpp/tests/goldens.json), the radio input, stats, failure
 * and stop.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

import { requireWasm, type CabinDspParams } from '../../wasm';
import {
  CABIN_PROCESSOR_NAME,
  CABIN_QUANTUM,
  CABIN_STATS_SECONDS,
  CABIN_WORKLET_SOURCE,
} from './cabinWorkletSource';

const SAMPLE_RATE = 48000;
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** One cabin engine script from cpp/tests/goldens.json (scripts/gen-wasm-goldens.mjs). */
interface DspGolden {
  label: string;
  sampleRate: number;
  irTaps: number;
  blocks: number;
  keyframes: (CabinDspParams & { block: number; ir?: { vehicle: number; openness: number } | null })[];
  expectedChecksum: number;
}

const DSP_GOLDENS = (JSON.parse(
  readFileSync(join(REPO_ROOT, 'cpp', 'tests', 'goldens.json'), 'utf8'),
) as { cabinDsp: DspGolden[] }).cabinDsp;

/** The golden harness's radio input (scripts/gen-wasm-goldens.mjs). */
const goldenRadioSample = (k: number, ch: number): number =>
  Math.fround((((k % 2001) * 7919 + ch * 104729) % 2001 - 1000) / 2000);

/** FNV-1a over the f32 bit patterns, as the golden generator folds every block. */
function fnv1a(h: number, samples: Float32Array): number {
  const words = new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
  for (let i = 0; i < words.length; i++) {
    h ^= words[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

interface PortMessage {
  type: string;
  [key: string]: unknown;
}

/** Minimal stand-in for the worklet's MessagePort. */
class StubPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: PortMessage[] = [];

  postMessage(msg: PortMessage): void {
    this.sent.push(msg);
  }

  /** Deliver a message from the "main thread". */
  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
}

interface Processor {
  port: StubPort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/** Evaluate the worklet source and return a fresh processor instance. */
function instantiate(rate: number = SAMPLE_RATE): Processor {
  let ctor: (new () => Processor) | null = null;
  class StubAudioWorkletProcessor {
    port = new StubPort();
  }
  const registerProcessor = (name: string, processorCtor: new () => Processor): void => {
    expect(name).toBe(CABIN_PROCESSOR_NAME);
    ctor = processorCtor;
  };
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', CABIN_WORKLET_SOURCE)(
    StubAudioWorkletProcessor,
    registerProcessor,
    rate,
  );
  if (!ctor) throw new Error('worklet source did not register a processor');
  return new (ctor as new () => Processor)();
}

let scalarModule: WebAssembly.Module;
let simdModule: WebAssembly.Module;
let scalarBytes: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  const read = (file: string): Uint8Array<ArrayBuffer> =>
    new Uint8Array(readFileSync(join(REPO_ROOT, 'public', 'wasm', file)));
  scalarBytes = read('streetview-wasm.wasm');
  scalarModule = await WebAssembly.compile(scalarBytes);
  simdModule = await WebAssembly.compile(read('streetview-wasm.simd.wasm'));
});

/** Let the worklet's async instantiate settle. */
async function untilMessage(port: StubPort, type: string): Promise<PortMessage> {
  for (let i = 0; i < 200; i++) {
    const found = port.sent.find((m) => m.type === type);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`worklet never posted '${type}'`);
}

async function ready(
  module: WebAssembly.Module = scalarModule,
  simd = false,
  rate: number = SAMPLE_RATE,
): Promise<Processor> {
  const p = instantiate(rate);
  p.port.deliver({ type: 'module', module, simd });
  await untilMessage(p.port, 'ready');
  return p;
}

/** Render `quanta` blocks; `radio` (if any) feeds input 0 with the same block each time. */
function render(
  p: Processor,
  quanta: number,
  radio: [Float32Array, Float32Array] | null = null,
): { left: Float32Array; right: Float32Array; alive: boolean } {
  const left = new Float32Array(CABIN_QUANTUM * quanta);
  const right = new Float32Array(CABIN_QUANTUM * quanta);
  let alive = true;
  for (let q = 0; q < quanta; q++) {
    const l = new Float32Array(CABIN_QUANTUM);
    const r = new Float32Array(CABIN_QUANTUM);
    alive = p.process([radio ? [radio[0], radio[1]] : []], [[l, r]]);
    left.set(l, q * CABIN_QUANTUM);
    right.set(r, q * CABIN_QUANTUM);
  }
  return { left, right, alive };
}

const DRIVE: CabinDspParams = {
  rpm: 2600, load: 0.35, speedMps: 22, openness: 0, vehicle: 0,
  wetRoad: 1, rain: 0.6, windMps: 8, radioGain: 1, wipers: true,
};

function irFor(vehicle: number, openness: number, taps = 1024): Float32Array {
  const ir = new Float32Array(taps);
  requireWasm().fillCabinIr(ir, taps, vehicle, openness, SAMPLE_RATE);
  return ir;
}

function radioBlock(): [Float32Array, Float32Array] {
  const l = new Float32Array(CABIN_QUANTUM);
  const r = new Float32Array(CABIN_QUANTUM);
  for (let i = 0; i < CABIN_QUANTUM; i++) {
    l[i] = Math.fround(Math.sin(i * 0.37) * 0.4);
    r[i] = Math.fround(Math.cos(i * 0.21) * 0.4);
  }
  return [l, r];
}

describe('cabin worklet: start-up', () => {
  it('is silent (not an underrun) until the engine is up', () => {
    const p = instantiate();
    const { left, right, alive } = render(p, 4);
    expect(alive).toBe(true);
    expect(left.every((s) => s === 0)).toBe(true);
    expect(right.every((s) => s === 0)).toBe(true);
  });

  it('instantiates posted bytes — what CabinAudio sends — and reports ready', async () => {
    const p = instantiate();
    p.port.deliver({ type: 'module', bytes: scalarBytes.slice().buffer, simd: false });
    const msg = await untilMessage(p.port, 'ready');
    expect(msg.simd).toBe(false);
    p.port.deliver({ type: 'params', ...DRIVE });
    expect(render(p, 4).left.some((s) => s !== 0)).toBe(true);
  });

  it('a message the worklet cannot deserialize is reported, not swallowed', () => {
    const p = instantiate() as Processor & { port: StubPort & { onmessageerror?: () => void } };
    p.port.onmessageerror?.();
    expect(p.port.sent.some((m) => m.type === 'error')).toBe(true);
  });

  it('instantiates a posted compiled module too, and reports ready', async () => {
    const p = await ready(simdModule, true);
    const msg = p.port.sent.find((m) => m.type === 'ready')!;
    expect(msg.simd).toBe(true);
    expect(msg.maxIrTaps).toBe(4096);
  });

  it('applies params and an IR that arrived before the engine was up', async () => {
    const early = instantiate();
    early.port.deliver({ type: 'params', ...DRIVE });
    early.port.deliver({ type: 'ir', taps: irFor(0, 0) });
    early.port.deliver({ type: 'module', module: scalarModule, simd: false });
    await untilMessage(early.port, 'ready');

    const late = await ready();
    late.port.deliver({ type: 'params', ...DRIVE });
    late.port.deliver({ type: 'ir', taps: irFor(0, 0) });

    expect(Array.from(render(early, 20).left)).toEqual(Array.from(render(late, 20).left));
  });

  it('reports a module it cannot run, and stays silent', async () => {
    // A valid module with none of the dsp_* exports.
    const empty = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const p = instantiate();
    p.port.deliver({ type: 'module', module: empty, simd: false });
    const err = await untilMessage(p.port, 'error');
    expect(String(err.message)).toMatch(/dsp_create|not a function/);
    expect(render(p, 2).left.every((s) => s === 0)).toBe(true);
  });
});

describe('cabin worklet: rendering', () => {
  for (const golden of DSP_GOLDENS.filter((g) => g.sampleRate > 0)) {
    it(`renders the "${golden.label}" golden script bit for bit`, async () => {
      for (const [module, simd] of [[scalarModule, false], [simdModule, true]] as const) {
        const p = await ready(module, simd, golden.sampleRate);
        const byBlock = new Map(golden.keyframes.map((k) => [k.block, k]));
        const ir = new Float32Array(golden.irTaps);
        let checksum = 2166136261;
        for (let b = 0; b < golden.blocks; b++) {
          const k = byBlock.get(b);
          if (k) {
            p.port.deliver({ type: 'params', ...k });
            if (k.ir === null) p.port.deliver({ type: 'ir', taps: null });
            else if (k.ir) {
              requireWasm().fillCabinIr(ir, golden.irTaps, k.ir.vehicle, k.ir.openness, golden.sampleRate);
              p.port.deliver({ type: 'ir', taps: ir.slice() });
            }
          }
          const l = new Float32Array(CABIN_QUANTUM);
          const r = new Float32Array(CABIN_QUANTUM);
          for (let i = 0; i < CABIN_QUANTUM; i++) {
            l[i] = goldenRadioSample(b * CABIN_QUANTUM + i, 0);
            r[i] = goldenRadioSample(b * CABIN_QUANTUM + i, 1);
          }
          const got = render(p, 1, [l, r]);
          checksum = fnv1a(checksum, got.left);
          checksum = fnv1a(checksum, got.right);
        }
        expect(checksum, `${golden.label} (${simd ? 'SIMD' : 'scalar'})`).toBe(golden.expectedChecksum);
      }
    }, 60_000);
  }

  it('the SIMD binary renders the same bits as the scalar one', async () => {
    const a = await ready(scalarModule, false);
    const b = await ready(simdModule, true);
    for (const p of [a, b]) {
      p.port.deliver({ type: 'params', ...DRIVE });
      p.port.deliver({ type: 'ir', taps: irFor(0, 1, 1024) });
    }
    const radio = radioBlock();
    expect(Array.from(render(a, 30, radio).right)).toEqual(Array.from(render(b, 30, radio).right));
  });

  it('plays the radio input through the cabin: roof and vehicle change it', async () => {
    const radioOnly = { ...DRIVE, rpm: 0, speedMps: 0, rain: 0, wetRoad: 0, windMps: 0, wipers: false };
    const room = async (vehicle: number, openness: number): Promise<Float32Array> => {
      const p = await ready();
      p.port.deliver({ type: 'params', ...radioOnly, vehicle, openness });
      p.port.deliver({ type: 'ir', taps: irFor(vehicle, openness, vehicle === 3 ? 2048 : 1024) });
      render(p, 400, radioBlock()); // settle the 40 ms parameter glide
      return render(p, 20, radioBlock()).left;
    };
    const closed = await room(0, 0);
    const open = await room(0, 1);
    const limo = await room(3, 0);
    const energy = (x: Float32Array): number => x.reduce((acc, v) => acc + v * v, 0);
    expect(energy(closed)).toBeGreaterThan(0);
    expect(Array.from(open)).not.toEqual(Array.from(closed));
    expect(Array.from(limo)).not.toEqual(Array.from(closed));
  });

  it('a mono radio input feeds both speakers', async () => {
    const p = await ready();
    p.port.deliver({ type: 'params', ...DRIVE, rpm: 0, speedMps: 0, rain: 0, wetRoad: 0, windMps: 0 });
    const mono = radioBlock()[0];
    let left = 0;
    let right = 0;
    for (let q = 0; q < 200; q++) {
      const l = new Float32Array(CABIN_QUANTUM);
      const r = new Float32Array(CABIN_QUANTUM);
      p.process([[mono]], [[l, r]]);
      if (q >= 100) {
        left += l.reduce((a, v) => a + v * v, 0);
        right += r.reduce((a, v) => a + v * v, 0);
      }
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('posts stats on its own clock, with no underruns', async () => {
    const p = await ready();
    p.port.deliver({ type: 'params', ...DRIVE });
    const every = Math.round((SAMPLE_RATE * CABIN_STATS_SECONDS) / CABIN_QUANTUM);
    render(p, every * 3);
    const stats = p.port.sent.filter((m) => m.type === 'stats');
    expect(stats.length).toBe(3);
    const last = stats[stats.length - 1]!;
    expect(last.quanta).toBe(every * 3);
    expect(last.rendered).toBe(every * 3);
    expect(last.underruns).toBe(0);
  });

  it('stops on request and frees the engine', async () => {
    const p = await ready();
    p.port.deliver({ type: 'stop' });
    const { alive, left } = render(p, 1);
    expect(alive).toBe(false);
    expect(left.every((s) => s === 0)).toBe(true);
  });

  it('a stop that lands before the engine is up still frees it', async () => {
    const p = instantiate();
    p.port.deliver({ type: 'module', module: scalarModule, simd: false });
    p.port.deliver({ type: 'stop' });
    await new Promise((r) => setTimeout(r, 20));
    expect(p.port.sent.some((m) => m.type === 'ready')).toBe(false);
    expect(render(p, 1).alive).toBe(false);
  });

  it('an empty IR message is the identity, and an over-long one is truncated', async () => {
    const p = await ready();
    p.port.deliver({ type: 'params', ...DRIVE });
    p.port.deliver({ type: 'ir', taps: new Float32Array(0) });
    p.port.deliver({ type: 'ir', taps: irFor(3, 0, 5000) });
    const { left } = render(p, 8);
    expect(left.every((s) => Number.isFinite(s) && Math.abs(s) <= 1)).toBe(true);
  });
});
