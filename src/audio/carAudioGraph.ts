/**
 * The car's audio graph on the app's one AudioContext (`audioRuntime.ts`), and
 * the radio route that decides whether the radio plays through the cabin.
 *
 * The cabin engine (`CabinAudio`, an AudioWorklet running the WASM DSP) and the
 * car radio (`AudioAnalyzer` behind `useCabinRadioBinding`) used to own an
 * AudioContext each, so the radio could never pass through the cabin: nodes
 * cannot connect across contexts. Both now acquire this graph instead.
 *
 *   radio <audio> ─► MediaElementSource ─► station gain (volume, crossfade)
 *                                              │
 *                                          radioBus ──► cabin worklet input ─► cabin ─► `cabin` bus
 *                                              │                               └──► analyser (dash visualiser)
 *                                              └─ (no cabin engine) ──────────► `radio` bus + analyser
 *
 * The buses mix through the runtime's master limiter into `destination`.
 * While the cabin engine is attached it owns the wind, so the `wind` bus
 * (`WindAudio`) is muted (#367; it used to be a check in the animator only).
 *
 * The context outlives individual `CabinAudio` instances (the car-mode effect
 * can recreate one while the radio keeps playing); with no users left it is
 * suspended, not closed, so a later car mode reuses it.
 */

import { acquireAudioRuntime, releaseAudioRuntime, setAudioBusMuted, type AudioRuntime } from './audioRuntime';

export interface CarAudioGraph {
  readonly ctx: AudioContext;
  /** The car radio connects here, after its own volume/crossfade gain. */
  readonly radioBus: GainNode;
  /**
   * Dash visualiser tap: the post-cabin mix while the cabin engine runs (the
   * radio as heard in the car, bed included), the raw radio otherwise.
   */
  readonly analyser: AnalyserNode;
  /** Where the cabin engine's output goes (the runtime's `cabin` bus). */
  readonly cabinBus: GainNode;
  /** The runtime's `radio` bus: the radio's direct route. */
  readonly radioOut: GainNode;
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
  g.radioBus.connect(g.radioOut);
  g.radioBus.connect(g.analyser);
}

/** The cabin engine owns the wind bed while attached: mute the `wind` bus. */
const CABIN_ENGINE_MUTE_OWNER = 'cabin-engine';

/**
 * Take a reference on the shared graph, creating the context on first use and
 * resuming it if it was suspended. Null when Web Audio is unavailable. Pair
 * every successful call with {@link releaseCarAudioGraph}.
 */
export function acquireCarAudioGraph(): CarAudioGraph | null {
  const rt: AudioRuntime | null = acquireAudioRuntime();
  if (!rt) return null;
  if (!graph || graph.ctx !== rt.ctx) {
    try {
      const radioBus = rt.ctx.createGain();
      const analyser = rt.ctx.createAnalyser();
      analyser.fftSize = 256;
      graph = { ctx: rt.ctx, radioBus, analyser, cabinBus: rt.buses.cabin, radioOut: rt.buses.radio };
      routeDirect(graph);
    } catch (err) {
      console.warn('[carAudioGraph] could not build the car graph', err);
      releaseAudioRuntime();
      return null;
    }
  }
  users += 1;
  return graph;
}

/** Drop a reference; the runtime suspends its context when nobody holds it (never closes it). */
export function releaseCarAudioGraph(): void {
  if (!graph || users === 0) return;
  users -= 1;
  releaseAudioRuntime();
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
  setAudioBusMuted('wind', CABIN_ENGINE_MUTE_OWNER, true);
  return () => {
    if (cabin !== attachment || !graph) return;
    safeDisconnect(output, graph.analyser);
    cabin = null;
    setAudioBusMuted('wind', CABIN_ENGINE_MUTE_OWNER, false);
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
  setAudioBusMuted('wind', CABIN_ENGINE_MUTE_OWNER, false);
}
