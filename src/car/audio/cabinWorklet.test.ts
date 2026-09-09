/**
 * The cabin AudioWorklet processor, exercised outside an AudioContext.
 *
 * `CABIN_WORKLET_SOURCE` is plain source text, so it can be evaluated here with
 * a stub `AudioWorkletProcessor`/`registerProcessor` and driven a render
 * quantum at a time. That covers the parts that would otherwise only run on a
 * real audio thread: the PCM queue and its back-pressure, the FIR convolution,
 * and what happens when the main thread falls behind.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  CABIN_PCM_BLOCK,
  CABIN_PROCESSOR_NAME,
  CABIN_QUEUE_TARGET_BLOCKS,
  CABIN_WORKLET_SOURCE,
} from './cabinWorkletSource';

const QUANTUM = 128;

interface PortMessage {
  type: string;
  blocks?: number;
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
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

/** Evaluate the worklet source and return a fresh processor instance. */
function instantiate(): Processor {
  let ctor: (new () => Processor) | null = null;
  class StubAudioWorkletProcessor {
    port = new StubPort();
  }
  const registerProcessor = (name: string, processorCtor: new () => Processor): void => {
    expect(name).toBe(CABIN_PROCESSOR_NAME);
    ctor = processorCtor;
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('AudioWorkletProcessor', 'registerProcessor', CABIN_WORKLET_SOURCE)(
    StubAudioWorkletProcessor,
    registerProcessor,
  );
  if (!ctor) throw new Error('worklet source did not register a processor');
  return new (ctor as new () => Processor)();
}

function render(processor: Processor, quanta = 1): Float32Array {
  const out = new Float32Array(QUANTUM * quanta);
  for (let q = 0; q < quanta; q++) {
    const channel = new Float32Array(QUANTUM);
    processor.process([], [[channel]]);
    out.set(channel, q * QUANTUM);
  }
  return out;
}

/** A PCM block of a constant value, so convolution results are easy to reason about. */
function block(value: number): Float32Array {
  return new Float32Array(CABIN_PCM_BLOCK).fill(value);
}

let processor: Processor;

beforeEach(() => {
  processor = instantiate();
});

describe('cabin worklet: PCM queue', () => {
  it('asks for a full queue as soon as it is constructed', () => {
    expect(processor.port.sent).toEqual([
      { type: 'need', blocks: CABIN_QUEUE_TARGET_BLOCKS },
    ]);
  });

  it('plays queued PCM back in order', () => {
    processor.port.deliver({ type: 'pcm', blocks: [block(0.5)] });
    const out = render(processor);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(0.5, 6);
  });

  it('outputs silence rather than throwing when the queue runs dry', () => {
    const out = render(processor, 2);
    expect(Array.from(out).every((sample) => sample === 0)).toBe(true);
  });

  it('only re-requests once the queue drops to the low-water mark', () => {
    processor.port.deliver({
      type: 'pcm',
      blocks: [block(0.1), block(0.1), block(0.1), block(0.1)],
    });
    processor.port.sent.length = 0;

    // One quantum out of ~4000 queued samples: still well above the mark.
    render(processor);
    expect(processor.port.sent).toEqual([]);

    // Drain past the low-water mark and it asks for exactly the shortfall.
    render(processor, Math.ceil((CABIN_PCM_BLOCK * 2) / QUANTUM));
    expect(processor.port.sent.length).toBe(1);
    expect(processor.port.sent[0]!.type).toBe('need');
    expect(processor.port.sent[0]!.blocks).toBeLessThanOrEqual(CABIN_QUEUE_TARGET_BLOCKS);
    expect(processor.port.sent[0]!.blocks).toBeGreaterThan(0);

    // ... and does not pile up a second request while one is outstanding.
    render(processor);
    expect(processor.port.sent.length).toBe(1);
  });

  it('stops the node when told to', () => {
    expect(processor.process([], [[new Float32Array(QUANTUM)]])).toBe(true);
    processor.port.deliver({ type: 'stop' });
    expect(processor.process([], [[new Float32Array(QUANTUM)]])).toBe(false);
  });
});

describe('cabin worklet: convolution', () => {
  it('applies the impulse response to the bed', () => {
    // [0.5, 0.25] convolved with a constant 1.0 bed settles at 0.75, one
    // sample after the first tap arrives.
    processor.port.deliver({ type: 'ir', taps: Float32Array.from([0.5, 0.25]) });
    processor.port.deliver({ type: 'pcm', blocks: [block(1)] });
    const out = render(processor);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.75, 6);
    expect(out[64]).toBeCloseTo(0.75, 6);
  });

  it('passes the bed through untouched before an IR arrives', () => {
    processor.port.deliver({ type: 'pcm', blocks: [block(0.3)] });
    const out = render(processor);
    expect(out[0]).toBeCloseTo(0.3, 6);
  });

  it('clamps the output to [-1, 1]', () => {
    processor.port.deliver({ type: 'ir', taps: Float32Array.from([1, 1, 1, 1]) });
    processor.port.deliver({ type: 'pcm', blocks: [block(1)] });
    const out = render(processor);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });

  it('swaps an IR of the same length without resetting the tail', () => {
    processor.port.deliver({ type: 'ir', taps: Float32Array.from([1, 0]) });
    processor.port.deliver({ type: 'pcm', blocks: [block(1), block(1)] });
    render(processor);
    // A roof toggle re-colours the same 128 taps; the history ring is reused,
    // so the second IR immediately sees the samples already in flight.
    processor.port.deliver({ type: 'ir', taps: Float32Array.from([0, 1]) });
    const out = render(processor);
    expect(out[0]).toBeCloseTo(1, 6);
  });
});
