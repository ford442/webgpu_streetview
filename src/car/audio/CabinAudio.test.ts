/**
 * CabinAudio's graph wiring, against a stub Web Audio implementation.
 *
 * The two things worth pinning here: the AudioWorklet is the default path (the
 * deprecated `createScriptProcessor` is never touched), and every degraded
 * environment — no worklet, a worklet that fails to load, no AudioContext at
 * all — leaves the cabin quiet instead of throwing into car mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CabinAudio } from './CabinAudio';
import { CABIN_IR_TAPS } from './cabinIr';
import { CABIN_PCM_BLOCK, CABIN_PROCESSOR_NAME } from './cabinWorkletSource';
import type { VehicleTelemetry } from '../VehicleDynamics';

interface PortMessage {
  type: string;
  blocks?: Float32Array[];
  taps?: Float32Array;
}

class StubPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: PortMessage[] = [];

  postMessage(msg: PortMessage): void {
    this.sent.push(msg);
  }

  /** Play the worklet asking the main thread for more PCM. */
  requestBlocks(blocks: number): void {
    this.onmessage?.({ data: { type: 'need', blocks } } as MessageEvent);
  }
}

const workletNodes: StubWorkletNode[] = [];

class StubWorkletNode {
  readonly port = new StubPort();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();

  constructor(_ctx: unknown, readonly name: string, readonly options: unknown) {
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

class StubAudioContext {
  static addModule = vi.fn(async () => {});
  readonly sampleRate = 44100;
  state: AudioContextState = 'running';
  readonly destination = {};
  readonly createScriptProcessor = vi.fn();
  readonly audioWorklet = { addModule: StubAudioContext.addModule };
  readonly resume = vi.fn(async () => {});
  readonly close = vi.fn(async () => {});

  createGain(): unknown {
    return { gain: stubParam(), connect: vi.fn(), disconnect: vi.fn() };
  }

  createBiquadFilter(): unknown {
    return {
      type: '',
      frequency: stubParam(),
      Q: stubParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createOscillator(): unknown {
    return {
      type: '',
      frequency: stubParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
}

/** A context with no AudioWorklet at all — an older Safari, in effect. */
class NoWorkletAudioContext extends StubAudioContext {
  override readonly audioWorklet = undefined as unknown as { addModule: () => Promise<void> };
}

const scope = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

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

beforeEach(() => {
  for (const key of ['AudioContext', 'AudioWorkletNode', 'URL']) saved[key] = scope[key];
  workletNodes.length = 0;
  StubAudioContext.addModule.mockClear();
  StubAudioContext.addModule.mockImplementation(async () => {});
  install(StubAudioContext, StubWorkletNode);
  // jsdom's URL has no Blob-URL support; the module only needs a string back.
  scope.URL = {
    createObjectURL: vi.fn(() => 'blob:cabin'),
    revokeObjectURL: vi.fn(),
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) scope[key] = value;
});

describe('CabinAudio: worklet path', () => {
  it('runs the bed through an AudioWorklet and never uses createScriptProcessor', async () => {
    const audio = new CabinAudio();
    await audio.start();

    expect(audio.isWorkletActive).toBe(true);
    expect(StubAudioContext.addModule).toHaveBeenCalledWith('blob:cabin');
    expect(workletNodes).toHaveLength(1);
    expect(workletNodes[0]!.name).toBe(CABIN_PROCESSOR_NAME);
    expect(workletNodes[0]!.connect).toHaveBeenCalled();

    const ctx = (audio as unknown as { ctx: StubAudioContext }).ctx;
    expect(ctx.createScriptProcessor).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('sends the cabin IR up front and fills PCM on demand', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;

    const ir = port.sent.find((msg) => msg.type === 'ir');
    expect(ir?.taps?.length).toBe(CABIN_IR_TAPS);

    port.requestBlocks(3);
    const pcm = port.sent.filter((msg) => msg.type === 'pcm');
    expect(pcm).toHaveLength(1);
    expect(pcm[0]!.blocks).toHaveLength(3);
    expect(pcm[0]!.blocks![0]!.length).toBe(CABIN_PCM_BLOCK);
    // The bed is real signal, not a zero-filled buffer.
    expect(pcm[0]!.blocks!.some((b) => b.some((s) => s !== 0))).toBe(true);
    audio.dispose();
  });

  it('re-sends the IR when the roof opens, but not on every frame', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const port = workletNodes[0]!.port;
    const irCount = (): number => port.sent.filter((msg) => msg.type === 'ir').length;
    expect(irCount()).toBe(1);

    audio.update(telemetry(), { openness: 0, vehicle: 'sedan' });
    audio.update(telemetry(), { openness: 0, vehicle: 'sedan' });
    expect(irCount()).toBe(1);

    audio.update(telemetry(), { openness: 1, vehicle: 'sedan' });
    expect(irCount()).toBe(2);

    audio.update(telemetry(), { openness: 1, vehicle: 'limousine' });
    expect(irCount()).toBe(3);

    // Roof open really is a different room, not a re-send of the same taps.
    const [, open, limo] = port.sent.filter((msg) => msg.type === 'ir');
    expect(Array.from(open!.taps!)).not.toEqual(Array.from(limo!.taps!));
    audio.dispose();
  });

  it('stops and disconnects the node on dispose', async () => {
    const audio = new CabinAudio();
    await audio.start();
    const node = workletNodes[0]!;
    audio.dispose();

    expect(node.port.sent.some((msg) => msg.type === 'stop')).toBe(true);
    expect(node.disconnect).toHaveBeenCalled();
    expect(audio.isWorkletActive).toBe(false);
  });
});

describe('CabinAudio: fallbacks', () => {
  it('falls back to oscillators when the context has no AudioWorklet', async () => {
    install(NoWorkletAudioContext, StubWorkletNode);
    const audio = new CabinAudio();
    await audio.start();

    expect(audio.isWorkletActive).toBe(false);
    expect(workletNodes).toHaveLength(0);
    expect(() => audio.update(telemetry(), { openness: 0.5 })).not.toThrow();
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
    audio.dispose();
  });

  it('stays quiet, and safe to update and dispose, with no AudioContext', async () => {
    scope.AudioContext = undefined;
    const audio = new CabinAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(audio.isWorkletActive).toBe(false);
    expect(() => audio.update(telemetry({ accelerating: true }), { openness: 1 })).not.toThrow();
    expect(() => audio.dispose()).not.toThrow();
  });
});
