/**
 * The cabin engine AudioWorklet processor, as source text.
 *
 * `CabinAudio` turns this into a Blob URL and hands it to
 * `audioWorklet.addModule()`, which is why it lives here as a string instead of
 * as a second entry point: the constants stay single-sourced with the main
 * thread, and no extra chunk or `src/**\/*.js` file ships.
 *
 * The processor hosts the worklet-only binary `streetview-dsp.simd.wasm`
 * (cpp/src/cabin_dsp_module.cpp + runtime.cpp, nothing else): no imports,
 * emmalloc, a fixed 1 MiB memory that never grows — so the typed-array views
 * over its I/O block are built once and stay valid. The main thread fetches
 * the binary once and posts its bytes — not a compiled `WebAssembly.Module`:
 * Chromium refuses to deserialize one in AudioWorkletGlobalScope (the port
 * gets `messageerror`, the message never arrives). The worklet instantiates
 * the bytes (a compiled module is accepted too, for engines that allow it),
 * checks every export against abi.h's arity table (abi.generated.ts, inlined
 * below), creates one engine and calls `dsp_render` every render quantum,
 * straight into the output channels. Input 0 is the car radio.
 *
 * Parameters arrive through the `SharedArrayBuffer` seqlock of
 * cabinParamRing.ts when the page is cross-origin isolated (read at the top
 * of every quantum; no message per frame), else as `params` messages. Either
 * way there is no PCM queue, so no main-thread stall (a Maps tile decode, a
 * React commit) can starve the engine.
 *
 * Protocol (main → worklet):
 *   { type: 'module', bytes: ArrayBuffer }     (or `module`)
 *   { type: 'ring', buffer: SharedArrayBuffer } the param seqlock
 *   { type: 'params', rpm, load, speedMps, openness, vehicle, wetRoad, rain,
 *     windMps, radioGain, wipers }        targets, when there is no ring
 *   { type: 'ir', taps: Float32Array }     cabin IR (the engine glides over)
 *   { type: 'stop' }
 * (worklet → main):
 *   { type: 'ready', maxIrTaps, memoryBytes }
 *   { type: 'stats', quanta, rendered, underruns, renderMsAvg, renderMsMax }
 *   { type: 'error', message }             instantiate/render failed, or a
 *                                          message could not be deserialized;
 *                                          the main thread falls back
 */
import { DSP_EXPORT_NAMES, WASM_ABI } from '../../wasm/abi.generated';
import { CABIN_RING_FIELDS } from './cabinParamRing';

/** `registerProcessor` name; must match the `AudioWorkletNode` constructor. */
export const CABIN_PROCESSOR_NAME = 'streetview-cabin-engine';

/** The Web Audio render quantum (and the engine's partition size). */
export const CABIN_QUANTUM = 128;

/** The worklet posts `stats` about this often. */
export const CABIN_STATS_SECONDS = 0.5;

/** `{ export: arity }` for the DSP binary, from abi.h. */
const DSP_ARITY = Object.fromEntries(DSP_EXPORT_NAMES.map((name) => [name, WASM_ABI[name].params.length]));

/** Ring slot of each `dsp_set_params` argument after `state`. */
const RING_SLOTS = Object.fromEntries(CABIN_RING_FIELDS.map((field, i) => [field, i + 1]));

/**
 * The processor source. Runs in `AudioWorkletGlobalScope`, which has no
 * `fetch`, no DOM and no module imports — everything it needs arrives over
 * `port`; `sampleRate` is a scope global.
 */
export const CABIN_WORKLET_SOURCE = `
const QUANTUM = ${CABIN_QUANTUM};
const DSP_ARITY = ${JSON.stringify(DSP_ARITY)};
const RING = ${JSON.stringify(RING_SLOTS)};
const clock = typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? () => performance.now()
  : null;

class CabinEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = true;
    this.exp = null;
    this.state = 0;
    this.io = 0;
    this.maxIrTaps = 0;
    this.views = null;
    this.ringSeq = null;
    this.ringF32 = null;
    this.ringSeen = 0;
    this.pendingParams = null;
    this.pendingIr = null;
    this.errored = false;
    this.quanta = 0;
    this.rendered = 0;
    this.underruns = 0;
    this.renderMsSum = 0;
    this.renderMsMax = 0;
    this.timed = 0;
    this.statsEvery = Math.max(1, Math.round((sampleRate * ${CABIN_STATS_SECONDS}) / QUANTUM));

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'module') {
        this.load(msg.bytes || msg.module);
      } else if (msg.type === 'ring') {
        this.ringSeq = new Int32Array(msg.buffer);
        this.ringF32 = new Float32Array(msg.buffer);
        this.ringSeen = 0;
      } else if (msg.type === 'params') {
        if (this.state) this.applyParams(msg);
        else this.pendingParams = msg;
      } else if (msg.type === 'ir') {
        if (this.state) this.applyIr(msg.taps);
        else this.pendingIr = msg.taps || null;
      } else if (msg.type === 'stop') {
        this.running = false;
        this.destroy();
      }
    };
    this.port.onmessageerror = () => this.fail(new Error('a message could not be deserialized in the worklet'));
  }

  async load(source) {
    try {
      if (!source) throw new Error('no binary in the module message');
      const result = await WebAssembly.instantiate(source, {});
      // Bytes give { module, instance }; a compiled module gives the instance.
      const exp = (result.instance || result).exports;
      const problems = [];
      for (const name in DSP_ARITY) {
        const fn = exp[name];
        if (typeof fn !== 'function') problems.push(name + ' missing');
        else if (fn.length !== DSP_ARITY[name]) problems.push(name + ' takes ' + fn.length + ', abi.h ' + DSP_ARITY[name]);
      }
      if (!(exp.memory instanceof WebAssembly.Memory)) problems.push('memory not exported');
      if (problems.length) throw new Error('cabin DSP ABI mismatch: ' + problems.join('; '));
      if (typeof exp._initialize === 'function') exp._initialize();
      const state = exp.dsp_create(sampleRate);
      if (!state) throw new Error('dsp_create returned null');
      const maxIrTaps = exp.dsp_max_ir_taps();
      // One block for the I/O: radio L/R, out L/R, then the IR.
      const io = exp.sv_malloc((QUANTUM * 4 + maxIrTaps) * 4);
      if (!io) throw new Error('sv_malloc for the cabin I/O failed');
      // The binary's memory is fixed (no memory.grow), so these never detach.
      const buffer = exp.memory.buffer;
      this.views = {
        inL: new Float32Array(buffer, io, QUANTUM),
        inR: new Float32Array(buffer, io + QUANTUM * 4, QUANTUM),
        outL: new Float32Array(buffer, io + QUANTUM * 8, QUANTUM),
        outR: new Float32Array(buffer, io + QUANTUM * 12, QUANTUM),
        ir: new Float32Array(buffer, io + QUANTUM * 16, maxIrTaps),
      };
      this.exp = exp;
      this.state = state;
      this.io = io;
      this.maxIrTaps = maxIrTaps;
      if (!this.running) {
        this.destroy();
        return;
      }
      if (this.pendingParams) this.applyParams(this.pendingParams);
      if (this.pendingIr) this.applyIr(this.pendingIr);
      this.pendingParams = null;
      this.pendingIr = null;
      this.port.postMessage({ type: 'ready', maxIrTaps: maxIrTaps, memoryBytes: buffer.byteLength });
    } catch (err) {
      this.fail(err);
    }
  }

  fail(err) {
    if (this.errored) return;
    this.errored = true;
    this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }

  applyParams(p) {
    this.exp.dsp_set_params(
      this.state, +p.rpm, +p.load, +p.speedMps, +p.openness, p.vehicle | 0,
      +p.wetRoad, +p.rain, +p.windMps, +p.radioGain, p.wipers ? 1 : 0,
    );
  }

  /** Apply the ring's targets if the writer settled a new set since the last quantum. */
  pollRing() {
    const seq = this.ringSeq;
    const s1 = Atomics.load(seq, 0);
    if (s1 === this.ringSeen || (s1 & 1) !== 0) return;
    const f = this.ringF32;
    const rpm = f[RING.rpm], load = f[RING.load], speedMps = f[RING.speedMps];
    const openness = f[RING.openness], vehicle = f[RING.vehicle], wetRoad = f[RING.wetRoad];
    const rain = f[RING.rain], windMps = f[RING.windMps], radioGain = f[RING.radioGain];
    const wipers = f[RING.wipers];
    // Torn by a concurrent write: keep the old targets, retry next quantum.
    if (Atomics.load(seq, 0) !== s1) return;
    this.ringSeen = s1;
    this.exp.dsp_set_params(
      this.state, rpm, load, speedMps, openness, vehicle | 0,
      wetRoad, rain, windMps, radioGain, wipers !== 0 ? 1 : 0,
    );
  }

  applyIr(taps) {
    if (!taps || taps.length === 0) {
      this.exp.dsp_set_ir(this.state, 0, 0);
      return;
    }
    const n = Math.min(taps.length, this.maxIrTaps);
    this.views.ir.set(n === taps.length ? taps : taps.subarray(0, n));
    this.exp.dsp_set_ir(this.state, this.io + QUANTUM * 16, n);
  }

  destroy() {
    if (this.exp && this.state) {
      this.exp.dsp_destroy(this.state);
      this.exp.sv_free(this.io);
    }
    this.state = 0;
    this.io = 0;
    this.views = null;
  }

  silence(output) {
    for (let c = 0; c < output.length; c++) output[c].fill(0);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return this.running;
    this.quanta++;

    if (!this.state) {
      // Before the engine is up (start-up) this is just silence; after it
      // has rendered, a silent quantum is an underrun.
      if (this.rendered > 0) this.underruns++;
      this.silence(output);
      this.maybeStats();
      return this.running;
    }

    if (this.ringSeq) this.pollRing();
    const left = output[0];
    const frames = Math.min(left.length, QUANTUM);
    const v = this.views;
    const input = inputs[0];
    const radioL = input && input[0];
    const radioR = input && (input[1] || input[0]);
    if (radioL) v.inL.set(radioL.subarray(0, frames)); else v.inL.fill(0);
    if (radioR) v.inR.set(radioR.subarray(0, frames)); else v.inR.fill(0);

    const t0 = clock ? clock() : 0;
    try {
      this.exp.dsp_render(
        this.state, this.io, this.io + QUANTUM * 4,
        this.io + QUANTUM * 8, this.io + QUANTUM * 12, frames,
      );
    } catch (err) {
      this.underruns++;
      this.silence(output);
      this.fail(err);
      this.maybeStats();
      return this.running;
    }
    if (clock) {
      const ms = clock() - t0;
      this.renderMsSum += ms;
      if (ms > this.renderMsMax) this.renderMsMax = ms;
      this.timed++;
    }

    left.set(v.outL.subarray(0, frames));
    if (output.length > 1) output[1].set(v.outR.subarray(0, frames));
    for (let c = 2; c < output.length; c++) output[c].fill(0);
    this.rendered++;
    this.maybeStats();
    return this.running;
  }

  maybeStats() {
    if (this.quanta % this.statsEvery !== 0) return;
    this.port.postMessage({
      type: 'stats',
      quanta: this.quanta,
      rendered: this.rendered,
      underruns: this.underruns,
      renderMsAvg: this.timed > 0 ? this.renderMsSum / this.timed : null,
      renderMsMax: this.timed > 0 ? this.renderMsMax : null,
    });
  }
}

registerProcessor('${CABIN_PROCESSOR_NAME}', CabinEngineProcessor);
`;
