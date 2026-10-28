/**
 * `window.__CABIN_AUDIO_PROBE__` — what the cabin audio engine is doing, for
 * e2e specs and the console. Deliberately not on the frozen
 * `__STREETVIEW_PROBE__`.
 *
 * The counters come from the AudioWorklet's own `stats` messages (about two a
 * second), so they describe the audio thread, not the main thread.
 */

type CabinAudioMode =
  /** The WASM cabin engine renders the bed inside the AudioWorklet. */
  | 'worklet-wasm'
  /** No worklet / no WASM: two oscillators through a biquad. */
  | 'oscillator'
  /** Not started, disposed, or no Web Audio at all. */
  | 'off';

export interface CabinAudioProbe {
  mode: CabinAudioMode;
  /** The worklet instantiated its binary and created the engine. */
  ready: boolean;
  /** The binary the worklet runs (`streetview-dsp.simd.wasm`); null off the WASM path. */
  binary: string | null;
  /**
   * How targets reach the worklet: `shared-ring` is the SharedArrayBuffer
   * seqlock (cabinParamRing.ts, cross-origin isolated pages), `message` the
   * per-frame postMessage fallback.
   */
  paramTransport: 'shared-ring' | 'message' | null;
  /** The worklet binary's linear memory, bytes — fixed (it has no memory.grow). */
  memoryBytes: number;
  sampleRate: number;
  /** Taps of the cabin IR last sent (per vehicle; see `cabinIrTaps`). */
  irTaps: number;
  /** Render quanta the worklet's `process()` has been called for. */
  quanta: number;
  /** Quanta the engine rendered. */
  rendered: number;
  /**
   * Quanta after the first rendered one that went out silent because the
   * engine could not render. Nothing on the main thread can cause one: the
   * engine needs no PCM from it.
   */
  underruns: number;
  /** Mean / worst `dsp_render` time per quantum, ms (null where the worklet scope has no clock). */
  renderMsAvg: number | null;
  renderMsMax: number | null;
  /** Last worklet error (instantiation / render), if any. */
  error?: string;
}

function emptyCabinAudioProbe(): CabinAudioProbe {
  return {
    mode: 'off',
    ready: false,
    binary: null,
    paramTransport: null,
    memoryBytes: 0,
    sampleRate: 0,
    irTaps: 0,
    quanta: 0,
    rendered: 0,
    underruns: 0,
    renderMsAvg: null,
    renderMsMax: null,
  };
}

/** Merge into the published probe (creating it on first use). */
export function publishCabinAudioProbe(patch: Partial<CabinAudioProbe>): void {
  if (typeof window === 'undefined') return;
  window.__CABIN_AUDIO_PROBE__ = { ...(window.__CABIN_AUDIO_PROBE__ ?? emptyCabinAudioProbe()), ...patch };
}
