/**
 * Cabin engine/road bed, cabin IR and occlusion filter.
 *
 * The bed is generated on this thread by the WASM `fill_engine_noise` export
 * (or its pure-JS twin) and queued to an AudioWorklet, which convolves it with
 * the cabin impulse response from `fill_cabin_ir` and writes it into the graph
 * beside radio/wind. Both numeric halves come from the C++ SSOT + goldens
 * pipeline in `docs/WASM_BRIDGE.md`.
 *
 * Why the PCM is filled here rather than inside the worklet: the loader,
 * its JS fallback and the golden-vector tests all live on this side, so the
 * audio thread needs neither a second WASM instantiation nor a branch on
 * `isWasm`. The worklet keeps ~90 ms queued and asks for more as it drains, so
 * the audio clock — not a timer — paces the fills.
 *
 * Nothing here throws into the caller: no AudioWorklet (or a worklet that
 * fails to load) falls back to two oscillators, and a failed `AudioContext`
 * leaves the cabin silent rather than breaking car mode.
 */

import { loadWasmModule, type StreetViewWasmAPI } from '../../wasm';
import type { VehicleTelemetry } from '../VehicleDynamics';
import type { VehicleType } from '../VehicleManager';
import { buildCabinIr } from './cabinIr';
import {
  CABIN_PCM_BLOCK,
  CABIN_PROCESSOR_NAME,
  CABIN_WORKLET_SOURCE,
} from './cabinWorkletSource';

export interface CabinOcclusion {
  /** 0 = windows sealed, 1 = fully open (convertible / roof). */
  openness: number;
  /** Which cabin the IR should model; defaults to the sedan room. */
  vehicle?: VehicleType;
}

export class CabinAudio {
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
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
  private vehicle: VehicleType = 'sedan';
  /** Openness/vehicle the IR currently on the worklet was built from. */
  private irOpenness = -1;
  private irVehicle: VehicleType | null = null;
  private usingWorklet = false;
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
      await this.attachWorklet();
      if (!this.usingWorklet) this.attachOscillatorFallback();
      this.started = true;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (err) {
      console.warn('[CabinAudio] start failed', err);
    }
  }

  /** True when the bed is running through the AudioWorklet (diagnostics/tests). */
  get isWorkletActive(): boolean {
    return this.usingWorklet;
  }

  private async attachWorklet(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.cabinFilter) return;
    if (typeof ctx.audioWorklet?.addModule !== 'function') return;
    if (typeof AudioWorkletNode !== 'function') return;

    let moduleUrl: string | null = null;
    try {
      // A Blob URL keeps the processor single-sourced with cabinWorkletSource.ts
      // instead of shipping a second entry point just to be addModule()-able.
      const blob = new Blob([CABIN_WORKLET_SOURCE], { type: 'application/javascript' });
      moduleUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(moduleUrl);

      const node = new AudioWorkletNode(ctx, CABIN_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent): void => {
        const msg = event.data as { type?: string; blocks?: number } | null;
        if (msg?.type === 'need') this.pushPcm(msg.blocks ?? 1);
      };
      node.connect(this.cabinFilter);
      this.worklet = node;
      this.usingWorklet = true;
      this.pushIr(true);
    } catch (err) {
      console.warn('[CabinAudio] AudioWorklet unavailable; using oscillators', err);
      this.usingWorklet = false;
      this.worklet = null;
    } finally {
      if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    }
  }

  /** Fill `blocks` PCM blocks from WASM (or its JS twin) and hand them over. */
  private pushPcm(blocks: number): void {
    const ctx = this.ctx;
    const node = this.worklet;
    const wasm = this.wasm;
    if (!ctx || !node) return;
    const sampleRate = ctx.sampleRate || 44100;
    const count = Math.max(1, Math.min(8, Math.floor(blocks)));
    const filled: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const block = new Float32Array(CABIN_PCM_BLOCK);
      if (wasm) {
        wasm.fillEngineNoise(
          block, block.length, this.rpm, this.load, this.speedKmh, this.timeSec, sampleRate,
        );
      }
      this.timeSec += block.length / sampleRate;
      filled.push(block);
    }
    node.port.postMessage(
      { type: 'pcm', blocks: filled },
      filled.map((block) => block.buffer),
    );
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
    });
    this.irVehicle = this.vehicle;
    this.irOpenness = this.openness;
    node.port.postMessage({ type: 'ir', taps }, [taps.buffer]);
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
    if (occlusion.vehicle) this.vehicle = occlusion.vehicle;
    // Only re-sends when the roof or the vehicle actually changed.
    this.pushIr();

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
      if (this.worklet) {
        this.worklet.port.postMessage({ type: 'stop' });
        this.worklet.port.onmessage = null;
        this.worklet.disconnect();
      }
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
    this.worklet = null;
    this.usingWorklet = false;
    this.oscA = null;
    this.oscB = null;
    this.started = false;
    this.ctx = null;
    this.irVehicle = null;
    this.irOpenness = -1;
  }
}
