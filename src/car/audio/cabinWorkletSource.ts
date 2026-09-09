/**
 * The cabin engine AudioWorklet processor, as source text.
 *
 * `CabinAudio` turns this into a Blob URL and hands it to
 * `audioWorklet.addModule()`, which is why it lives here as a string instead of
 * as a second entry point: the constants below stay single-sourced with the
 * main-thread side, and no extra chunk or `src/**\/*.js` file ships.
 *
 * The processor itself does no synthesis. PCM is generated on the main thread
 * by the WASM `fill_engine_noise` export (or its JS twin) and queued here; the
 * worklet drains that queue and convolves it with the cabin IR from
 * `fill_cabin_ir`. One numeric SSOT, and the audio thread never allocates or
 * calls into WebAssembly.
 */

/** `registerProcessor` name; must match the `AudioWorkletNode` constructor. */
export const CABIN_PROCESSOR_NAME = 'streetview-cabin-engine';

/** Samples per queued PCM block (~23 ms at 44.1 kHz). */
export const CABIN_PCM_BLOCK = 1024;

/** Blocks the worklet tries to keep queued ahead of the render quantum. */
export const CABIN_QUEUE_TARGET_BLOCKS = 4;

/** Refill is requested once the queue falls to this many blocks. */
export const CABIN_QUEUE_LOW_BLOCKS = 2;

/**
 * The processor source. Runs in `AudioWorkletGlobalScope`, which has no
 * `fetch`, no DOM and no module imports — everything it needs arrives over
 * `port`.
 */
export const CABIN_WORKLET_SOURCE = `
class CabinEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Queued PCM blocks from the main thread, oldest first. */
    this.queue = [];
    /** Read cursor inside queue[0]. */
    this.readPos = 0;
    /** Total samples still queued, tracked so process() never walks the list. */
    this.queued = 0;
    /** Cabin impulse response (Float32Array) and its FIR history ring. */
    this.ir = null;
    this.history = null;
    this.historyPos = 0;
    /** At most one outstanding refill request. */
    this.pending = false;
    this.running = true;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'pcm') {
        this.pending = false;
        for (let i = 0; i < msg.blocks.length; i++) {
          const block = msg.blocks[i];
          if (block && block.length > 0) {
            this.queue.push(block);
            this.queued += block.length;
          }
        }
      } else if (msg.type === 'ir') {
        this.setIr(msg.taps);
      } else if (msg.type === 'stop') {
        this.running = false;
      }
    };

    this.request();
  }

  setIr(taps) {
    if (!taps || taps.length === 0) {
      this.ir = null;
      this.history = null;
      return;
    }
    this.ir = taps;
    // Reuse the ring when the length is unchanged (the usual case: a roof
    // toggle re-colours the same 128 taps), so the tail carries over instead
    // of clicking through a zeroed history.
    if (!this.history || this.history.length !== taps.length) {
      this.history = new Float32Array(taps.length);
      this.historyPos = 0;
    }
  }

  /** Ask the main thread for whatever it takes to reach the target depth. */
  request() {
    if (this.pending || !this.running) return;
    const have = Math.ceil(this.queued / ${CABIN_PCM_BLOCK});
    const blocks = ${CABIN_QUEUE_TARGET_BLOCKS} - have;
    if (blocks <= 0) return;
    this.pending = true;
    this.port.postMessage({ type: 'need', blocks: blocks });
  }

  /** Next queued sample, or 0 when the main thread has fallen behind. */
  nextSample() {
    while (this.queue.length > 0) {
      const block = this.queue[0];
      if (this.readPos < block.length) {
        const sample = block[this.readPos];
        this.readPos++;
        this.queued--;
        return sample;
      }
      this.queue.shift();
      this.readPos = 0;
    }
    return 0;
  }

  /** One FIR tap-and-accumulate against the cabin IR. */
  convolve(sample) {
    const ir = this.ir;
    const history = this.history;
    if (!ir || !history) return sample;
    const n = ir.length;
    this.historyPos = this.historyPos === 0 ? n - 1 : this.historyPos - 1;
    history[this.historyPos] = sample;
    let acc = 0;
    let h = this.historyPos;
    for (let k = 0; k < n; k++) {
      acc += ir[k] * history[h];
      h++;
      if (h === n) h = 0;
    }
    return acc;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const channel = output && output[0];
    if (!channel) return this.running;

    for (let i = 0; i < channel.length; i++) {
      let sample = this.convolve(this.nextSample());
      // The IR has unity DC gain but a resonant cabin can still overshoot on
      // a transient; clamp rather than let the graph clip downstream.
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      channel[i] = sample;
    }

    // Copy the mono bed to any extra channels the destination asked for.
    for (let c = 1; c < output.length; c++) output[c].set(channel);

    if (this.queued <= ${CABIN_QUEUE_LOW_BLOCKS} * ${CABIN_PCM_BLOCK}) this.request();
    return this.running;
  }
}

registerProcessor('${CABIN_PROCESSOR_NAME}', CabinEngineProcessor);
`;
