// @vitest-environment jsdom
/**
 * The car's shared audio graph: one context for the cabin engine and the car
 * radio, a radio bus that runs through the engine while it is up, and an
 * `AudioAnalyzer` that joins it instead of opening a context of its own.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  acquireCarAudioGraph,
  attachCabinEngine,
  isCabinEngineAttached,
  releaseCarAudioGraph,
  resetCarAudioGraphForTests,
} from './carAudioGraph';
import { AudioAnalyzer } from './AudioAnalyzer';
import { isAudioBusMuted, resetAudioRuntimeForTests } from './audioRuntime';
import {
  StubNode,
  contexts,
  installStubAudioContext,
  removeAudioContext,
  restoreAudioContext,
  type StubAudioContext,
} from './__tests__/stubAudioContext';

beforeEach(() => {
  installStubAudioContext();
  resetAudioRuntimeForTests();
  resetCarAudioGraphForTests();
});

afterEach(() => {
  restoreAudioContext();
});

describe('carAudioGraph', () => {
  it('shares one context between every user', () => {
    const a = acquireCarAudioGraph()!;
    const b = acquireCarAudioGraph()!;
    expect(a.ctx).toBe(b.ctx);
    expect(contexts).toHaveLength(1);
  });

  it('plays the radio straight out (and into the tap) with no cabin engine', () => {
    const g = acquireCarAudioGraph()!;
    const bus = g.radioBus as unknown as StubNode;
    // Out through the runtime's `radio` bus (#367), never to `destination` directly.
    expect(bus.connections.has(g.radioOut)).toBe(true);
    expect(bus.connections.has(g.ctx.destination)).toBe(false);
    expect(bus.connections.has(g.analyser)).toBe(true);
    expect(isCabinEngineAttached()).toBe(false);
  });

  it('routes the radio through the cabin engine, and back out when it detaches', () => {
    const g = acquireCarAudioGraph()!;
    const bus = g.radioBus as unknown as StubNode;
    const engine = new StubNode();
    const detach = attachCabinEngine(engine as unknown as AudioNode, engine as unknown as AudioNode);
    expect(isCabinEngineAttached()).toBe(true);
    // The engine owns the wind bed: the `wind` bus is muted while it runs.
    expect(isAudioBusMuted('wind')).toBe(true);
    expect([...bus.connections]).toEqual([engine]);
    // The visualiser hears the post-cabin mix.
    expect(engine.connections.has(g.analyser)).toBe(true);

    detach();
    expect(isCabinEngineAttached()).toBe(false);
    expect(isAudioBusMuted('wind')).toBe(false);
    expect(bus.connections.has(g.radioOut)).toBe(true);
    expect(engine.connections.has(g.analyser)).toBe(false);
  });

  it('a stale detach does not undo a newer engine', () => {
    acquireCarAudioGraph();
    const first = new StubNode();
    const second = new StubNode();
    const detachFirst = attachCabinEngine(first as unknown as AudioNode, first as unknown as AudioNode);
    attachCabinEngine(second as unknown as AudioNode, second as unknown as AudioNode);
    detachFirst();
    expect(isCabinEngineAttached()).toBe(true);
  });

  it('suspends (never closes) when the last user leaves, and resumes for the next', () => {
    const g = acquireCarAudioGraph()!;
    acquireCarAudioGraph();
    const ctx = g.ctx as unknown as StubAudioContext;
    releaseCarAudioGraph();
    expect(ctx.suspend).not.toHaveBeenCalled();
    releaseCarAudioGraph();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(ctx.close).not.toHaveBeenCalled();
    acquireCarAudioGraph();
    expect(ctx.resume).toHaveBeenCalled();
    releaseCarAudioGraph();
    releaseCarAudioGraph(); // over-release is a no-op
  });

  it('is null without Web Audio', () => {
    removeAudioContext();
    expect(acquireCarAudioGraph()).toBeNull();
    expect(() => releaseCarAudioGraph()).not.toThrow();
  });
});

describe('AudioAnalyzer on the car graph', () => {
  it('joins the shared context, feeds the radio bus, and taps the shared analyser', async () => {
    const g = acquireCarAudioGraph()!;
    const analyzer = new AudioAnalyzer({ carCabin: true });
    expect(await analyzer.init('https://example.test/stream')).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(analyzer.getAnalyser()).toBe(g.analyser);
    // Station gain → radio bus (and so through the cabin when it runs),
    // never straight to the destination.
    const stationGain = contexts[0]!.gains.at(-1)!;
    expect(stationGain).not.toBe(g.radioBus);
    expect([...stationGain.connections]).toEqual([g.radioBus]);
    analyzer.dispose();
    expect(contexts[0]!.close).not.toHaveBeenCalled();
  });

  it('without the option it still joins the one context, on the radio bus, and never closes it', async () => {
    const g = acquireCarAudioGraph()!;
    const analyzer = new AudioAnalyzer();
    expect(await analyzer.init('https://example.test/stream')).toBe(true);
    expect(contexts).toHaveLength(1);
    const analyser = analyzer.getAnalyser() as unknown as StubNode;
    expect(analyser).not.toBe(g.analyser);
    expect(analyser.connections.has(g.radioOut)).toBe(true);
    analyzer.dispose();
    expect(contexts[0]!.close).not.toHaveBeenCalled();
  });
});
