/**
 * Cabin engine/road bed + occlusion filter.
 *
 * Hot PCM comes from WASM `fill_engine_noise` when the module is available;
 * otherwise a pure-JS fill (same ABI) or two oscillators so a missing binary
 * never silences the cabin. Mixes into the Web Audio graph beside radio/wind.
 *
 * Cabin IR (`fill_cabin_ir`) is intentionally not added here — new DSP
 * exports go through the C++ SSOT + goldens pipeline, not a hand-grown WAT.
 */

import { loadWasmModule, type StreetViewWasmAPI } from '../../wasm';
import type { VehicleTelemetry } from '../VehicleDynamics';

export interface CabinOcclusion {
  /** 0 = windows sealed, 1 = fully open (convertible / roof). */
  openness: number;
}

const BLOCK = 1024;

export class CabinAudio {
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private cabinFilter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscGain: GainNode | null = null;
  private wasm: StreetViewWasmAPI | null = null;
  private timeSec = 0;
  private rpm = 850;
  private load = 0.15;
  private speedKmh = 0;
  private openness = 0;
  private usingProcessor = false;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.12;
      this.cabinFilter = this.ctx.createBiquadFilter();
      this.cabinFilter.type = 'lowpass';
      this.cabinFilter.frequency.value = 900;
      this.cabinFilter.Q.value = 0.7;
      this.cabinFilter.connect(this.master);
      this.master.connect(this.ctx.destination);

      this.wasm = await loadWasmModule();
      this.attachProcessor();
      if (!this.usingProcessor) this.attachOscillatorFallback();
      this.started = true;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (err) {
      console.warn('[CabinAudio] start failed', err);
    }
  }

  private attachProcessor(): void {
    if (!this.ctx || !this.cabinFilter) return;
    const Ctor = this.ctx.createScriptProcessor.bind(this.ctx);
    if (typeof Ctor !== 'function') return;
    try {
      const proc = this.ctx.createScriptProcessor(BLOCK, 0, 1);
      proc.onaudioprocess = (ev) => {
        const out = ev.outputBuffer.getChannelData(0);
        const sr = this.ctx?.sampleRate ?? 44100;
        const load = this.wasm ?? null;
        if (load) {
          load.fillEngineNoise(out, out.length, this.rpm, this.load, this.speedKmh, this.timeSec, sr);
        } else {
          out.fill(0);
        }
        this.timeSec += out.length / sr;
      };
      proc.connect(this.cabinFilter);
      this.processor = proc;
      this.usingProcessor = true;
    } catch {
      this.usingProcessor = false;
    }
  }

  private attachOscillatorFallback(): void {
    if (!this.ctx || !this.cabinFilter) return;
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
  }

  update(telem: VehicleTelemetry, occlusion: CabinOcclusion): void {
    this.rpm = telem.rpm;
    this.speedKmh = telem.speedKmh;
    this.load = telem.accelerating ? 0.85 : telem.speedKmh > 1 ? 0.35 : 0.12;
    this.openness = Math.max(0, Math.min(1, occlusion.openness));

    if (this.cabinFilter) {
      const closedHz = 780;
      const openHz = 4200;
      this.cabinFilter.frequency.value = closedHz + (openHz - closedHz) * this.openness;
    }
    if (this.master) {
      const windLift = 0.12 + this.openness * 0.08 + Math.min(0.08, this.speedKmh / 2000);
      this.master.gain.value = telem.speedKmh < 0.4 && !telem.accelerating ? 0.04 : windLift;
    }
    if (this.oscA && this.ctx) {
      this.oscA.frequency.setTargetAtTime(Math.max(40, this.rpm / 60), this.ctx.currentTime, 0.08);
    }
    if (this.oscB && this.ctx) {
      this.oscB.frequency.setTargetAtTime(Math.max(80, this.rpm / 30), this.ctx.currentTime, 0.08);
    }
  }

  dispose(): void {
    try {
      this.processor?.disconnect();
      this.oscA?.stop();
      this.oscB?.stop();
      this.oscA?.disconnect();
      this.oscB?.disconnect();
      this.oscGain?.disconnect();
      this.cabinFilter?.disconnect();
      this.master?.disconnect();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.processor = null;
    this.oscA = null;
    this.oscB = null;
    this.started = false;
    this.ctx = null;
  }
}
