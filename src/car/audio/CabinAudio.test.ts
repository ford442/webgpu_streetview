// @vitest-environment jsdom
/**
 * CabinAudio's graph wiring, against a stub Web Audio implementation.
 *
 * Worth pinning here: the WASM engine in an AudioWorklet is the default path
 * (the DSP binary's bytes are posted to it; no PCM ever is), the IR and params
 * protocol (messages, or the shared seqlock when cross-origin isolated), the radio bus routed through the engine, the probe, and that every
 * degraded environment — no worklet, a binary that will not compile or
 * instantiate, `?cabinDsp=off`, no AudioContext — leaves the cabin on the
 * oscillator fallback or quiet instead of throwing into car mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const wasmMocks = vi.hoisted(() => ({
  compile: vi.fn(),
}));

vi.mock('../../wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../wasm')>();
  return {
    ...actual,
    // loadWasmModule stays real: src/setupTests.ts installed the committed binary.
    loadStreetViewWasmBytes: wasmMocks.compile,
  };
});

import { CabinAudio } from './CabinAudio';
import { CABIN_RING_BYTES, CABIN_RING_FIELDS } from './cabinParamRing';
import { CABIN_IR_TAPS } from './cabinIr';
import { CABIN_PROCESSOR_NAME } from './cabinWorkletSource';
import { isCabinEngineAttached, resetCarAudioGraphForTests } from '../../audio/carAudioGraph';
import type { VehicleTelemetry } from '../VehicleDynamics';

interface PortMessage {
  type: string;
  taps?: Float32Array;
  module?: unknown;
  [key: string]: unknown;
}

class StubPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: PortMessage[] = [];

  postMessage(msg: PortMessage, _transfer?: Transferable[]): void {
    this.sent.push(msg);
  }

  /** Play a message from the worklet. */
  fromWorklet(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

/** Every stub node records what it was connected to. */
class StubNode {
  readonly connections = new Set<unknown>();
  readonly connect = vi.fn((dest: unknown) => {
    this.connections.add(dest);
  });

  readonly disconnect = vi.fn((dest?: unknown) => {
    if (dest === undefined) this.connections.clear();
    else this.connections.delete(dest);
  });
}

const workletNodes: StubWorkletNode[] = [];

class StubWorkletNode extends StubNode {
  readonly port = new StubPort();

  constructor(_ctx: unknown, readonly name: string, readonly options: AudioWorkletNodeOptions) {
    super();
    workletNodes.push(this);
  }
}

class FailingWorkletNode {
  constructor() {
    throw new Error('no such processor');
  }
}

function stubParam(value = 0): { value: number; setTargetAtTime: () => void } {
  return { value, setTargetAtTime: vi.fn() };
}

const contexts: StubAudioContext[] = [];

class StubAudioContext {
  static addModule = vi.fn(async () => {});
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly destination = new StubNode();
  readonly createScriptProcessor = vi.fn();
  readonly audioWorklet: { addModule: (url: string) => Promise<void> } = {
    addModule: StubAudioContext.addModule,
  };
  readonly resume = vi.fn(async () => {});
  readonly suspend = vi.fn(async () => {});
  readonly close = vi.fn(async () => {});
  readonly oscillators: ReturnType<StubAudioContext['createOscillator']>[] = [];

  constructor() {
    contexts.push(this);
  }

  createGain(): StubNode & { gain: ReturnType<typeof stubParam> } {
    return Object.assign(new StubNode(), { gain: stubParam(1) });
  }

  createAnalyser(): StubNode & { fftSize: number } {
    return Object.assign(new StubNode(), { fftSize: 2048 });
  }

  createBiquadFilter(): unknown {
    return Object.assign(new StubNode(), { type: '', frequency: stubParam(), Q: stubParam() });
  }

  createOscillator(): StubNode & { start: () => void; stop: () => void } {
    const osc = Object.assign(new StubNode(), {
      type: '',
      frequency: stubParam(),
      start: vi.fn(),
      stop: vi.fn(),
    });
    this.oscillators.push(osc);
    return osc;
  }
}

/** A context with no AudioWorklet at all — an older Safari, in effect. */
class NoWorkletAudioContext extends StubAudioContext {
  override readonly audioWorklet =
    undefined as unknown as { addModule: (url: string) => Promise<void> };
}

const scope = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const FAKE_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;

function install(ctxCtor: unknown, nodeCtor: unknown): void {
  scope.AudioContext = ctxCtor;
  scope.AudioWorkletNode = nodeCtor;
}

const telemetry = (over: Partial<VehicleTelemetry> = {}): VehicleTelemetry => ({
  speedKmh: 42,
  rpm: 2400,
  gear: 'D',
  accelerating: false,
  ...over,
});

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  for (const key of ['AudioContext', 'AudioWorkletNode', 'URL']) saved[key] = scope[key];
  workletNodes.length = 0;
  contexts.length = 0;
  resetCarAudioGraphForTests();
  delete window.__CABIN_AUDIO_PROBE__;
  setSearch('');
  StubAudioContext.addModule.mockClear();
  StubAudioContext.addModule.mockImplementation(async () => {});
  wasmMocks.compile.mockReset();
  wasmMocks.compile.mockImplementation(async () => FAKE_BYTES);
  install(StubAudioContext, StubWorkletNode);
  // jsdom's URL has no Blob-URL support; the module only needs a string back.
  scope.URL = Object.assign(function URL() {}, {
    createObjectURL: vi.fn(() => 'blob:cabin'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) scope[key] = value;
  delete scope['crossOriginIsolated'];
});

describe('CabinAudio: worklet engine path', () => {
  it('posts the worklet-only DSP binary to an AudioWorklet and never touches createScriptProcessor', async () => {
    const audio = new CabinAudio();
    await audio.start();

    expect(audio.isWorkletActive).toBe(true);
    expect(wasmMocks.compile).toHaveBeenCalledWith('dsp');
    expect(StubAudioContext.addModule).toHaveBeenCalledWith('blob:cabin');
    expect(workletNodes).toHaveLength(1);
    const node = workletNodes[0]!;
    expect(node.name).toBe(CABIN_PROCESSOR_NAME);
    expect(node.options).toMatchObject({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const moduleMsg = node.port.sent.find((m) => m.type === 'module');
    // A copy of the bytes (the loader keeps its cache), not a compiled Module:
    // Chromium will not deserialize one in the worklet.
    expect(moduleMsg?.bytes).toBeInstanceOf(ArrayBuffer);
    expect(moduleMsg?.bytes).not.toBe(FAKE_BYTES);
    expect(new Uint8Array(moduleMsg!.bytes as ArrayBuffer)).toEqual(new Uint8Array(FAKE_BYTES));
    // No PCM protocol any more: the engine renders in the worklet.
    expect(node.port.sent.some((m) => m.type === 'pcm')).toBe(false);
    expect(contexts[0]!.createScriptProcessor).not.toHaveBeenCalled();
    audio.dispose();
  });


  it('sends the vehicle\'s long IR up front, and re-sends it only when the room changes', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;
    const irs = (): PortMessage[] => port.sent.filter((msg) => msg.type === 'ir');
    expect(irs()).toHaveLength(1);
    expect(irs()[0]!.taps!.length).toBe(CABIN_IR_TAPS.sedan);

    audio.update(telemetry(), { openness: 0, vehicle: 'sedan' });
    audio.update(telemetry(), { openness: 0, vehicle: 'sedan' });
    expect(irs()).toHaveLength(1);

    audio.update(telemetry(), { openness: 1, vehicle: 'sedan' });
    expect(irs()).toHaveLength(2);

    audio.update(telemetry(), { openness: 1, vehicle: 'limousine' });
    expect(irs()).toHaveLength(3);
    expect(irs()[2]!.taps!.length).toBe(CABIN_IR_TAPS.limousine);

    // Roof open really is a different room, not a re-send of the same taps.
    const [closed, open] = irs();
    expect(Array.from(open!.taps!.subarray(0, 64))).not.toEqual(Array.from(closed!.taps!.subarray(0, 64)));
    expect(window.__CABIN_AUDIO_PROBE__?.irTaps).toBe(CABIN_IR_TAPS.limousine);
    audio.dispose();
  });

  it('posts the engine targets every frame, from telemetry, the roof and the weather', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;
    audio.update(telemetry({ speedKmh: 72, rpm: 3100 }), { openness: 1, vehicle: 'cortianics' }, {
      rainIntensity: 50, wind: -40, wipersEnabled: true,
    });
    audio.update(telemetry({ speedKmh: 72, rpm: 3100 }), { openness: 1, vehicle: 'cortianics' });
    const params = port.sent.filter((m) => m.type === 'params');
    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({
      rpm: 3100, speedMps: 20, openness: 1, vehicle: 4, rain: 0.5, wetRoad: 1, windMps: 8, wipers: true,
    });
    // No environment: a calm, dry day.
    expect(params[1]).toMatchObject({ rain: 0, wetRoad: 0, windMps: 0, wipers: false });
    expect(port.sent.some((m) => m.type === 'ring')).toBe(false);
    expect(window.__CABIN_AUDIO_PROBE__?.paramTransport).toBe('message');
    audio.dispose();
  });

  it('writes the targets into the shared seqlock instead when the page is cross-origin isolated', async () => {
    scope['crossOriginIsolated'] = true;
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;
    const ringMsg = port.sent.find((m) => m.type === 'ring');
    expect(ringMsg?.buffer).toBeInstanceOf(SharedArrayBuffer);
    const buffer = ringMsg!.buffer as SharedArrayBuffer;
    expect(buffer.byteLength).toBe(CABIN_RING_BYTES);
    const seq = new Int32Array(buffer);
    const f32 = new Float32Array(buffer);
    expect(seq[0]).toBe(0);

    audio.update(telemetry({ speedKmh: 72, rpm: 3100 }), { openness: 1, vehicle: 'cortianics' }, {
      rainIntensity: 50, wind: -40, wipersEnabled: true,
    });
    // Settled (even) after one write; no per-frame message.
    expect(seq[0]).toBe(2);
    expect(port.sent.some((m) => m.type === 'params')).toBe(false);
    const slot = (field: (typeof CABIN_RING_FIELDS)[number]): number => f32[CABIN_RING_FIELDS.indexOf(field) + 1]!;
    expect(slot('rpm')).toBe(3100);
    expect(slot('speedMps')).toBe(20);
    expect(slot('vehicle')).toBe(4);
    expect(slot('rain')).toBe(0.5);
    expect(slot('wipers')).toBe(1);
    audio.update(telemetry({ speedKmh: 72, rpm: 3100 }), { openness: 1, vehicle: 'cortianics' });
    expect(seq[0]).toBe(4);
    expect(slot('wipers')).toBe(0);
    expect(window.__CABIN_AUDIO_PROBE__?.paramTransport).toBe('shared-ring');
    audio.dispose();
  });

  it('routes the radio bus through the engine while it runs', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const node = workletNodes[0]!;
    expect(isCabinEngineAttached()).toBe(true);
    // The worklet feeds the master (→ destination) and the visualiser tap.
    expect(node.connect).toHaveBeenCalledTimes(2);
    audio.dispose();
    expect(isCabinEngineAttached()).toBe(false);
  });

  it('publishes ready and the worklet\'s stats on the probe', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;
    expect(window.__CABIN_AUDIO_PROBE__).toMatchObject({
      mode: 'worklet-wasm', ready: false, binary: 'streetview-dsp.simd.wasm', sampleRate: 48000,
    });
    port.fromWorklet({ type: 'ready', maxIrTaps: 16384, memoryBytes: 1 << 20 });
    port.fromWorklet({ type: 'stats', quanta: 750, rendered: 748, underruns: 0, renderMsAvg: 0.05, renderMsMax: 0.2 });
    expect(window.__CABIN_AUDIO_PROBE__).toMatchObject({
      mode: 'worklet-wasm', ready: true, memoryBytes: 1 << 20, quanta: 750, rendered: 748, underruns: 0, renderMsAvg: 0.05,
    });
    audio.dispose();
    expect(window.__CABIN_AUDIO_PROBE__).toMatchObject({ mode: 'off', ready: false });
  });

  it('falls back to oscillators when the worklet cannot run the engine', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const node = workletNodes[0]!;
    node.port.fromWorklet({ type: 'error', message: 'dsp_create returned null' });
    expect(audio.isWorkletActive).toBe(false);
    expect(node.port.sent.some((m) => m.type === 'stop')).toBe(true);
    expect(node.disconnect).toHaveBeenCalled();
    expect(isCabinEngineAttached()).toBe(false);
    expect(contexts[0]!.oscillators).toHaveLength(2);
    expect(window.__CABIN_AUDIO_PROBE__).toMatchObject({ mode: 'oscillator', error: 'dsp_create returned null' });
    expect(() => audio.update(telemetry(), { openness: 0.5 })).not.toThrow();
    audio.dispose();
  });

  it('stops and disconnects the node on dispose, and leaves the shared context open', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const node = workletNodes[0]!;
    audio.dispose();

    expect(node.port.sent.some((msg) => msg.type === 'stop')).toBe(true);
    expect(node.disconnect).toHaveBeenCalled();
    expect(audio.isWorkletActive).toBe(false);
    expect(contexts[0]!.close).not.toHaveBeenCalled();
    // The last user gone: suspended for the next car mode, not closed.
    expect(contexts[0]!.suspend).toHaveBeenCalled();
  });

  it('a dispose during start never attaches a worklet', async () => {
    let release: (m: unknown) => void = () => {};
    wasmMocks.compile.mockImplementation(() => new Promise((r) => { release = r; }));
    const audio = new CabinAudio();
    const starting = audio.start();
    await new Promise((r) => setTimeout(r, 0));
    audio.dispose();
    release(FAKE_BYTES);
    await starting;
    expect(workletNodes).toHaveLength(0);
    expect(audio.isWorkletActive).toBe(false);
  });
});

describe('CabinAudio: fallbacks', () => {
  it('uses oscillators with ?cabinDsp=off', async () => {
    setSearch('?cabinDsp=off');
    const audio = new CabinAudio();
    await audio.start();
    expect(wasmMocks.compile).not.toHaveBeenCalled();
    expect(audio.isWorkletActive).toBe(false);
    expect(window.__CABIN_AUDIO_PROBE__?.mode).toBe('oscillator');
    audio.dispose();
  });

  it('falls back to oscillators when the context has no AudioWorklet', async () => {
    install(NoWorkletAudioContext, StubWorkletNode);
    const audio = new CabinAudio();
    await audio.start();

    expect(audio.isWorkletActive).toBe(false);
    expect(workletNodes).toHaveLength(0);
    expect(() => audio.update(telemetry(), { openness: 0.5 })).not.toThrow();
    audio.dispose();
  });

  it('falls back when the binary cannot be fetched or compiled', async () => {
    wasmMocks.compile.mockRejectedValueOnce(new Error('HTTP 404'));
    const audio = new CabinAudio();
    await audio.start();
    expect(audio.isWorkletActive).toBe(false);
    expect(window.__CABIN_AUDIO_PROBE__?.mode).toBe('oscillator');
    audio.dispose();
  });

  it('falls back when addModule rejects', async () => {
    StubAudioContext.addModule.mockRejectedValueOnce(new Error('blocked'));
    const audio = new CabinAudio();
    await audio.start();
    expect(audio.isWorkletActive).toBe(false);
    audio.dispose();
  });

  it('falls back when the processor cannot be constructed', async () => {
    install(StubAudioContext, FailingWorkletNode);
    const audio = new CabinAudio();
    await audio.start();
    expect(audio.isWorkletActive).toBe(false);
    expect(isCabinEngineAttached()).toBe(false);
    audio.dispose();
  });

  it('stays quiet, and safe to update and dispose, with no AudioContext', async () => {
    scope.AudioContext = undefined;
    const audio = new CabinAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(audio.isWorkletActive).toBe(false);
    expect(() => audio.update(telemetry({ accelerating: true }), { openness: 1 })).not.toThrow();
    expect(() => audio.dispose()).not.toThrow();
    expect(window.__CABIN_AUDIO_PROBE__?.mode).toBe('off');
  });
});
