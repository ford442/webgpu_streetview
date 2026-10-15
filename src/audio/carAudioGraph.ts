/**
 * The car's one AudioContext, and the radio bus that decides whether the radio
 * plays through the cabin.
 *
 * The cabin engine (`CabinAudio`, an AudioWorklet running the WASM DSP) and the
 * car radio (`AudioAnalyzer` behind `useCabinRadioBinding`) used to own an
 * AudioContext each, so the radio could never pass through the cabin: nodes
 * cannot connect across contexts. Both now acquire this graph instead.
 *
 *   radio <audio> ─► MediaElementSource ─► station gain (volume, crossfade)
 *                                              │
 *                                          radioBus ──► cabin worklet input ─► cabin ─► destination
 *                                              │                               └──► analyser (dash visualiser)
 *                                              └─ (no cabin engine) ──────────► destination + analyser
 *
 * The context outlives individual `CabinAudio` instances (the car-mode effect
 * can recreate one while the radio keeps playing); with no users left it is
 * suspended, not closed, so a later car mode reuses it.
 */

import { createBrowserAudioContext } from './createAudioContext';

export interface CarAudioGraph {
  readonly ctx: AudioContext;
  /** The car radio connects here, after its own volume/crossfade gain. */
  readonly radioBus: GainNode;
  /**
   * Dash visualiser tap: the post-cabin mix while the cabin engine runs (the
   * radio as heard in the car, bed included), the raw radio otherwise.
   */
  readonly analyser: AnalyserNode;
}

interface CabinAttachment {
  input: AudioNode;
  output: AudioNode;
}

let graph: CarAudioGraph | null = null;
let cabin: CabinAttachment | null = null;
let users = 0;

function safeDisconnect(node: AudioNode, destination?: AudioNode): void {
  try {
    if (destination) node.disconnect(destination);
    else node.disconnect();
  } catch {
    /* not connected */
  }
}

function routeDirect(g: CarAudioGraph): void {
  safeDisconnect(g.radioBus);
  g.radioBus.connect(g.ctx.destination);
  g.radioBus.connect(g.analyser);
}

/**
 * Take a reference on the shared graph, creating the context on first use and
 * resuming it if it was suspended. Null when Web Audio is unavailable. Pair
 * every successful call with {@link releaseCarAudioGraph}.
 */
export function acquireCarAudioGraph(): CarAudioGraph | null {
  if (!graph) {
    try {
      const ctx = createBrowserAudioContext();
      const radioBus = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      graph = { ctx, radioBus, analyser };
      routeDirect(graph);
    } catch (err) {
      console.warn('[carAudioGraph] Web Audio unavailable', err);
      return null;
    }
  }
  users += 1;
  if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => {});
  return graph;
}

/** Drop a reference; the last one suspends the context (never closes it). */
export function releaseCarAudioGraph(): void {
  if (!graph || users === 0) return;
  users -= 1;
  if (users === 0 && graph.ctx.state === 'running') void graph.ctx.suspend().catch(() => {});
}

/**
 * Route the radio through the cabin engine: radioBus → `input`, and the
 * engine's `output` feeds the analyser tap. Returns the detach function, which
 * restores the direct route (a later attach supersedes an earlier one).
 */
export function attachCabinEngine(input: AudioNode, output: AudioNode): () => void {
  const g = graph;
  if (!g) return () => {};
  if (cabin) safeDisconnect(cabin.output, g.analyser);
  safeDisconnect(g.radioBus);
  g.radioBus.connect(input);
  output.connect(g.analyser);
  const attachment: CabinAttachment = { input, output };
  cabin = attachment;
  return () => {
    if (cabin !== attachment || !graph) return;
    safeDisconnect(output, graph.analyser);
    cabin = null;
    routeDirect(graph);
  };
}

/**
 * True while the WASM cabin engine renders the bed — it then owns the wind, so
 * the separate `WindAudio` bed stays off instead of doubling it.
 */
export function isCabinEngineAttached(): boolean {
  return cabin !== null;
}

/** Test-only: forget the graph (the next acquire builds a fresh one). */
export function resetCarAudioGraphForTests(): void {
  graph = null;
  cabin = null;
  users = 0;
}
