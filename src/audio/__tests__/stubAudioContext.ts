/** A recording Web Audio stub for jsdom: nodes remember what they connect to. */
import { vi } from 'vitest';

export class StubNode {
  readonly connections = new Set<unknown>();
  readonly connect = vi.fn((dest: unknown) => {
    this.connections.add(dest);
  });

  readonly disconnect = vi.fn((dest?: unknown) => {
    if (dest === undefined) this.connections.clear();
    else this.connections.delete(dest);
  });
}

function stubParam(value: number) {
  return {
    value,
    setTargetAtTime: vi.fn(function (this: { value: number }, target: number) {
      this.value = target;
    }),
  };
}

export const contexts: StubAudioContext[] = [];

export class StubAudioContext {
  state: AudioContextState = 'running';
  readonly destination = new StubNode();
  readonly currentTime = 0;
  readonly baseLatency = 0.005;
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });

  readonly suspend = vi.fn(async () => {
    this.state = 'suspended';
  });

  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });

  readonly sampleRate = 48000;

  constructor() {
    contexts.push(this);
  }

  readonly gains: Array<StubNode & { gain: ReturnType<typeof stubParam> }> = [];

  createGain(): StubNode & { gain: ReturnType<typeof stubParam> } {
    const node = Object.assign(new StubNode(), { gain: stubParam(1) });
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor(): StubNode & Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', { value: number }> {
    return Object.assign(new StubNode(), {
      threshold: stubParam(-24),
      knee: stubParam(30),
      ratio: stubParam(12),
      attack: stubParam(0.003),
      release: stubParam(0.25),
    });
  }

  createAnalyser(): StubNode & { fftSize: number; frequencyBinCount: number } {
    return Object.assign(new StubNode(), { fftSize: 2048, frequencyBinCount: 128 });
  }

  createMediaElementSource(): StubNode {
    return new StubNode();
  }
}

const scope = globalThis as unknown as Record<string, unknown>;
let saved: unknown;

export function installStubAudioContext(): void {
  saved = scope.AudioContext;
  scope.AudioContext = StubAudioContext;
  contexts.length = 0;
}

export function restoreAudioContext(): void {
  scope.AudioContext = saved;
}

export function removeAudioContext(): void {
  scope.AudioContext = undefined;
}
