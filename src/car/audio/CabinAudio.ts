/**
 * The car's sound: the WASM cabin engine in an AudioWorklet.
 *
 * The whole bed — engine, road, wind, rain on the roof, wiper thumps — and
 * the car radio are rendered at audio rate by `dsp_render`
 * (cpp/src/cabin_dsp_module.cpp) inside the worklet, convolved with the
 * cabin IR of the current vehicle and roof (`fill_cabin_ir`) and placed by the
 * head-shadow model. This thread fetches the worklet-only binary once
 * (`loadStreetViewWasmBytes('dsp')`: the engine alone, fixed memory, < 32 KB),
 * posts a copy of the bytes to the worklet, which instantiates them there, and
 * from then on only writes targets every frame — into the shared seqlock of
 * cabinParamRing.ts when the page is cross-origin isolated, else as `params`
 * messages — and posts IRs when the room changes. There is no PCM queue, so
 * nothing this thread does — a Maps tile decode, a React commit — can make
 * the cabin click.
 *
 * Radio: `useCabinRadioBinding`'s `AudioAnalyzer` shares this context
 * (`audio/carAudioGraph.ts`); while the engine runs, the radio bus feeds the
 * worklet's input, so the station sounds different roof-up, roof-down and in
 * the limousine, and the dash visualiser taps the post-cabin mix.
 *
 * Nothing here throws into the caller: no AudioWorklet, no WebAssembly, a
 * worklet that fails to load or instantiate, or `?cabinDsp=off` all fall back
 * to two oscillators; a missing AudioContext leaves the cabin silent.
 * `window.__CABIN_AUDIO_PROBE__` reports which path is live.
 */

import {
  acquireCarAudioGraph,
  attachCabinEngine,
  releaseCarAudioGraph,
  type CarAudioGraph,
} from '../../audio/carAudioGraph';
import { readFlag } from '../../config/flags';
import {
  loadStreetViewWasmBytes,
  loadWasmModule,
  WASM_BINARY_FILES,
  type CabinDspParams,
  type StreetViewWasmAPI,
} from '../../wasm';
import type { VehicleTelemetry } from '../VehicleDynamics';
import type { VehicleType } from '../VehicleManager';
import { publishCabinAudioProbe } from './cabinAudioProbe';
import { buildCabinIr, cabinIrTaps } from './cabinIr';
import { cabinParamRingSupported, createCabinParamRing, type CabinParamRing } from './cabinParamRing';
import { CALM_CABIN_ENVIRONMENT, cabinDspParams, type CabinEnvironment } from './cabinParams';
import { CABIN_PROCESSOR_NAME, CABIN_WORKLET_SOURCE } from './cabinWorkletSource';

export type { CabinEnvironment } from './cabinParams';

export interface CabinOcclusion {
  /** 0 = windows sealed, 1 = fully open (convertible / roof). */
  openness: number;
  /** Which cabin the IR should model; defaults to the sedan room. */
  vehicle?: VehicleType;
}

interface WorkletMessage {
  type?: string;
  maxIrTaps?: number;
  memoryBytes?: number;
  quanta?: number;
  rendered?: number;
  underruns?: number;
  renderMsAvg?: number | null;
  renderMsMax?: number | null;
  message?: string;
}

export class CabinAudio {
  private graph: CarAudioGraph | null = null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  /** The shared param seqlock, when the page is cross-origin isolated. */
  private ring: CabinParamRing | null = null;
  private detachRadio: (() => void) | null = null;
  private cabinFilter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscGain: GainNode | null = null;
  private wasm: StreetViewWasmAPI | null = null;
  private params: CabinDspParams | null = null;
  private openness = 0;
  private vehicle: VehicleType = 'sedan';
  /** Openness/vehicle the IR currently on the worklet was built from. */
  private irOpenness = -1;
  private irVehicle: VehicleType | null = null;
  private started = false;
  private disposed = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const graph = acquireCarAudioGraph();
      if (!graph) {
        publishCabinAudioProbe({ mode: 'off', ready: false });
        return;
      }
      this.graph = graph;
      this.ctx = graph.ctx;
      this.master = graph.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(graph.ctx.destination);
      publishCabinAudioProbe({ mode: 'off', ready: false, sampleRate: graph.ctx.sampleRate });

      // The main-thread module only builds IRs (cold); the worklet gets its
      // own compiled binary below.
      this.wasm = await loadWasmModule();
      if (this.disposed) return;
      if (readFlag('cabinDsp') !== 'off') await this.attachWorklet();
      if (this.disposed) return;
      if (!this.worklet) this.attachOscillatorFallback();
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
    } catch (err) {
      console.warn('[CabinAudio] start failed', err);
    }
  }

  /** True when the bed is running through the AudioWorklet (diagnostics/tests). */
  get isWorkletActive(): boolean {
    return this.worklet !== null;
  }

  private async attachWorklet(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (typeof ctx.audioWorklet?.addModule !== 'function') return;
    if (typeof AudioWorkletNode !== 'function' || typeof WebAssembly === 'undefined') return;

    let moduleUrl: string | null = null;
    let node: AudioWorkletNode | null = null;
    try {
      const bytes = await loadStreetViewWasmBytes('dsp');
      // A Blob URL keeps the processor single-sourced with cabinWorkletSource.ts
      // instead of shipping a second entry point just to be addModule()-able.
      const blob = new Blob([CABIN_WORKLET_SOURCE], { type: 'application/javascript' });
      moduleUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(moduleUrl);
      if (this.disposed) return;

      node = new AudioWorkletNode(ctx, CABIN_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        // The radio arrives on input 0 as stereo (mono stations upmix).
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent): void => {
        this.onWorkletMessage(event.data as WorkletMessage | null);
      };
      // A copy, transferred: the loader keeps its cached bytes.
      const copy = bytes.slice(0);
      node.port.postMessage({ type: 'module', bytes: copy }, [copy]);
      const ring = cabinParamRingSupported() ? createCabinParamRing() : null;
      if (ring) node.port.postMessage({ type: 'ring', buffer: ring.buffer });
      node.connect(this.master);
      this.worklet = node;
      this.ring = ring;
      this.detachRadio = attachCabinEngine(node, node);
      publishCabinAudioProbe({
        mode: 'worklet-wasm',
        binary: WASM_BINARY_FILES.dsp,
        paramTransport: ring ? 'shared-ring' : 'message',
        ready: false,
        error: undefined,
      });
      this.pushIr(true);
      if (this.params) this.sendParams(this.params);
    } catch (err) {
      console.warn('[CabinAudio] cabin engine unavailable; using oscillators', err);
      if (node) {
        node.port.onmessage = null;
        try { node.disconnect(); } catch { /* never connected */ }
      }
      this.worklet = null;
    } finally {
      if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    }
  }

  private onWorkletMessage(msg: WorkletMessage | null): void {
    if (!msg) return;
    if (msg.type === 'ready') {
      publishCabinAudioProbe({ ready: true, memoryBytes: msg.memoryBytes ?? 0 });
    } else if (msg.type === 'stats') {
      publishCabinAudioProbe({
        quanta: msg.quanta ?? 0,
        rendered: msg.rendered ?? 0,
        underruns: msg.underruns ?? 0,
        renderMsAvg: msg.renderMsAvg ?? null,
        renderMsMax: msg.renderMsMax ?? null,
      });
    } else if (msg.type === 'error') {
      console.warn('[CabinAudio] cabin engine failed in the worklet; using oscillators', msg.message);
      publishCabinAudioProbe({ error: msg.message ?? 'unknown' });
      this.dropWorklet();
      if (!this.disposed) this.attachOscillatorFallback();
    }
  }

  private dropWorklet(): void {
    const node = this.worklet;
    if (!node) return;
    try {
      node.port.postMessage({ type: 'stop' });
      node.port.onmessage = null;
      node.disconnect();
    } catch {
      /* already gone */
    }
    this.detachRadio?.();
    this.detachRadio = null;
    this.worklet = null;
    this.ring = null;
    publishCabinAudioProbe({ mode: 'off', ready: false });
  }

  /** This frame's targets: through the shared ring when there is one, else a message. */
  private sendParams(params: CabinDspParams): void {
    if (this.ring) this.ring.write(params);
    else this.worklet?.port.postMessage({ type: 'params', ...params });
  }

  /** Rebuild and send the cabin IR when the room it models has changed. */
  private pushIr(force = false): void {
    const ctx = this.ctx;
    const node = this.worklet;
    const wasm = this.wasm;
    if (!ctx || !node || !wasm) return;
    if (!force && this.irVehicle === this.vehicle && this.irOpenness === this.openness) return;
    const taps = buildCabinIr(wasm, {
      vehicle: this.vehicle,
      openness: this.openness,
      sampleRate: ctx.sampleRate || 44100,
      taps: cabinIrTaps(this.vehicle),
    });
    this.irVehicle = this.vehicle;
    this.irOpenness = this.openness;
    // Read before the transfer detaches the buffer (length 0 afterwards).
    const irTaps = taps.length;
    node.port.postMessage({ type: 'ir', taps }, [taps.buffer]);
    publishCabinAudioProbe({ irTaps });
  }

  private attachOscillatorFallback(): void {
    if (!this.ctx || !this.master || this.oscA) return;
    this.cabinFilter = this.ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 900;
    this.cabinFilter.Q.value = 0.7;
    this.cabinFilter.connect(this.master);
    this.master.gain.value = 0.12;
    this.oscA = this.ctx.createOscillator();
    this.oscB = this.ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB.type = 'triangle';
    this.oscGain = this.ctx.createGain();
    this.oscGain.gain.value = 0.08;
    this.oscA.connect(this.oscGain);
    this.oscB.connect(this.oscGain);
    this.oscGain.connect(this.cabinFilter);
    this.oscA.start();
    this.oscB.start();
    publishCabinAudioProbe({ mode: 'oscillator', ready: true, binary: null, paramTransport: null });
  }

  update(
    telem: VehicleTelemetry,
    occlusion: CabinOcclusion,
    environment: CabinEnvironment = CALM_CABIN_ENVIRONMENT,
  ): void {
    this.openness = Math.max(0, Math.min(1, occlusion.openness));
    if (occlusion.vehicle) this.vehicle = occlusion.vehicle;
    this.params = cabinDspParams(telem, { openness: this.openness, vehicle: this.vehicle }, environment);

    if (this.worklet) {
      // Only re-sends when the roof or the vehicle actually changed.
      this.pushIr();
      this.sendParams(this.params);
      return;
    }

    if (this.cabinFilter) {
      const closedHz = 780;
      const openHz = 4200;
      this.cabinFilter.frequency.value = closedHz + (openHz - closedHz) * this.openness;
    }
    if (this.master && this.oscA) {
      const windLift = 0.12 + this.openness * 0.08 + Math.min(0.08, telem.speedKmh / 2000);
      this.master.gain.value = telem.speedKmh < 0.4 && !telem.accelerating ? 0.04 : windLift;
    }
    if (this.oscA && this.ctx) {
      this.oscA.frequency.setTargetAtTime(Math.max(40, telem.rpm / 60), this.ctx.currentTime, 0.08);
    }
    if (this.oscB && this.ctx) {
      this.oscB.frequency.setTargetAtTime(Math.max(80, telem.rpm / 30), this.ctx.currentTime, 0.08);
    }
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.dropWorklet();
      this.oscA?.stop();
      this.oscB?.stop();
      this.oscA?.disconnect();
      this.oscB?.disconnect();
      this.oscGain?.disconnect();
      this.cabinFilter?.disconnect();
      this.master?.disconnect();
    } catch {
      /* already stopped */
    }
    // The context is shared with the radio and outlives this instance.
    if (this.graph) releaseCarAudioGraph();
    this.graph = null;
    this.worklet = null;
    this.oscA = null;
    this.oscB = null;
    this.oscGain = null;
    this.cabinFilter = null;
    this.master = null;
    this.ctx = null;
    this.irVehicle = null;
    this.irOpenness = -1;
    publishCabinAudioProbe({ mode: 'off', ready: false });
  }
}
