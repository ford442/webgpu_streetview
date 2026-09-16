/**
 * WindAudio's HRTF graph, against a stub Web Audio implementation.
 *
 * The panner path must work synchronously inside init() (nothing here should
 * ever go silent while WASM loads), and the graph must upgrade to a pair of
 * ConvolverNodes once loadWasmModule() resolves, rebuilding their buffers only
 * when the heading actually moved enough to matter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WindAudio } from './WindAudio';

function stubParam(value = 0): { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } {
  return { value, setTargetAtTime: vi.fn() };
}

class StubGainNode {
  gain = stubParam(0);
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class StubStereoPannerNode {
  pan = stubParam(0);
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class StubBiquadFilterNode {
  type = '';
  frequency = stubParam(200);
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class StubBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  readonly connect = vi.fn();
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly disconnect = vi.fn();
}

class StubAudioBuffer {
  private data = new Float32Array(0);
  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number,
  ) {}
  copyToChannel(source: Float32Array): void {
    this.data = Float32Array.from(source);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

const convolverNodes: StubConvolverNode[] = [];

class StubConvolverNode {
  normalize = true;
  buffer: StubAudioBuffer | null = null;
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  constructor() {
    convolverNodes.push(this);
  }
}

class StubChannelMergerNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class StubAudioContext {
  readonly sampleRate = 44100;
  readonly currentTime = 0;
  state: AudioContextState = 'running';
  readonly destination = {};
  readonly resume = vi.fn(async () => {});
  readonly close = vi.fn(async () => {});

  createGain(): StubGainNode {
    return new StubGainNode();
  }
  createStereoPanner(): StubStereoPannerNode {
    return new StubStereoPannerNode();
  }
  createBiquadFilter(): StubBiquadFilterNode {
    return new StubBiquadFilterNode();
  }
  createBufferSource(): StubBufferSourceNode {
    return new StubBufferSourceNode();
  }
  createBuffer(channels: number, length: number, sampleRate: number): StubAudioBuffer {
    return new StubAudioBuffer(channels, length, sampleRate);
  }
  createConvolver(): StubConvolverNode {
    return new StubConvolverNode();
  }
  createChannelMerger(_count: number): StubChannelMergerNode {
    return new StubChannelMergerNode();
  }
}

const scope = globalThis as unknown as Record<string, unknown>;
let savedAudioContext: unknown;

beforeEach(() => {
  savedAudioContext = scope.AudioContext;
  convolverNodes.length = 0;
  scope.AudioContext = StubAudioContext;
});

afterEach(() => {
  scope.AudioContext = savedAudioContext;
});

interface WindAudioInternals {
  convolverL: StubConvolverNode | null;
  convolverR: StubConvolverNode | null;
  merger: StubChannelMergerNode | null;
  gainNode: StubGainNode | null;
  pannerNode: StubStereoPannerNode | null;
  audioContext: StubAudioContext | null;
}

async function initAndUpgrade(wind: WindAudio): Promise<WindAudioInternals> {
  await wind.init();
  await wind.waitUntilHrtfReady();
  return wind as unknown as WindAudioInternals;
}

describe('WindAudio: HRTF upgrade', () => {
  it('wires the StereoPannerNode graph synchronously in init()', async () => {
    const wind = new WindAudio();
    const ok = await wind.init();
    expect(ok).toBe(true);

    const internals = wind as unknown as WindAudioInternals;
    expect(internals.gainNode?.connect).toHaveBeenCalledWith(internals.pannerNode);
    expect(internals.pannerNode?.connect).toHaveBeenCalledWith(internals.audioContext?.destination);
    wind.dispose();
  });

  it('upgrades the graph to two ConvolverNodes once WASM has loaded', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    expect(convolverNodes).toHaveLength(2);
    expect(internals.convolverL).not.toBeNull();
    expect(internals.convolverR).not.toBeNull();
    // Auto-normalize would rescale the IR by a formula unrelated to the
    // interaural level difference fill_hrtf computed.
    expect(internals.convolverL?.normalize).toBe(false);
    expect(internals.convolverR?.normalize).toBe(false);

    // Rewired away from the panner, onto the convolver pair, into the merger.
    expect(internals.gainNode?.disconnect).toHaveBeenCalledWith(internals.pannerNode);
    expect(internals.pannerNode?.disconnect).toHaveBeenCalledWith(internals.audioContext?.destination);
    expect(internals.gainNode?.connect).toHaveBeenCalledWith(internals.convolverL);
    expect(internals.gainNode?.connect).toHaveBeenCalledWith(internals.convolverR);
    expect(internals.convolverL?.connect).toHaveBeenCalledWith(internals.merger, 0, 0);
    expect(internals.convolverR?.connect).toHaveBeenCalledWith(internals.merger, 0, 1);
    expect(internals.merger?.connect).toHaveBeenCalledWith(internals.audioContext?.destination);

    wind.dispose();
  });

  it('seeds a centered (non-null) IR pair immediately, so the graph is never silently silent', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    expect(internals.convolverL?.buffer).not.toBeNull();
    expect(internals.convolverR?.buffer).not.toBeNull();
    // Centered: both ears identical, unit impulse at tap 0.
    expect(internals.convolverL!.buffer!.getChannelData()[0]).toBe(1);
    expect(internals.convolverR!.buffer!.getChannelData()[0]).toBe(1);
    expect(Array.from(internals.convolverL!.buffer!.getChannelData())).toEqual(
      Array.from(internals.convolverR!.buffer!.getChannelData()),
    );

    wind.dispose();
  });

  it('setHeadingPan rebuilds the IR pair with the near ear at full gain, far ear attenuated', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    // Head turned right of the car body -> pan right, same convention as
    // cabinAudioPanFromHeadYaw.
    wind.setHeadingPan(45, 0);

    const left = internals.convolverL!.buffer!.getChannelData();
    const right = internals.convolverR!.buffer!.getChannelData();
    expect(right[0]).toBe(1); // near ear: undelayed, full gain
    expect(left[0]).toBe(0); // far ear: delayed off tap 0

    wind.dispose();
  });

  it('mirrors left/right for the opposite heading', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    wind.setHeadingPan(-45, 0);

    const left = internals.convolverL!.buffer!.getChannelData();
    const right = internals.convolverR!.buffer!.getChannelData();
    expect(left[0]).toBe(1);
    expect(right[0]).toBe(0);

    wind.dispose();
  });

  it('does not rebuild the IR pair for sub-threshold heading changes', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    wind.setHeadingPan(10, 0);
    const bufferAfterFirst = internals.convolverL!.buffer;

    wind.setHeadingPan(10.5, 0); // < 2 degree rebuild threshold
    expect(internals.convolverL!.buffer).toBe(bufferAfterFirst);

    wind.setHeadingPan(30, 0); // well past the threshold
    expect(internals.convolverL!.buffer).not.toBe(bufferAfterFirst);

    wind.dispose();
  });

  it('still updates the StereoPannerNode fallback after the upgrade', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);

    wind.setHeadingPan(30, 0);
    expect(internals.pannerNode?.pan.setTargetAtTime).toHaveBeenCalled();
  });

  it('disposes the convolver graph without throwing', async () => {
    const wind = new WindAudio();
    const internals = await initAndUpgrade(wind);
    const { convolverL, convolverR, merger } = internals;

    expect(() => wind.dispose()).not.toThrow();
    expect(convolverL?.disconnect).toHaveBeenCalled();
    expect(convolverR?.disconnect).toHaveBeenCalled();
    expect(merger?.disconnect).toHaveBeenCalled();
  });

  it('stays on the panner path when there is no AudioContext at all', async () => {
    scope.AudioContext = undefined;
    const wind = new WindAudio();
    const ok = await wind.init();
    expect(ok).toBe(false);
    expect(() => wind.setHeadingPan(20, 0)).not.toThrow();
    expect(() => wind.dispose()).not.toThrow();
  });
});
