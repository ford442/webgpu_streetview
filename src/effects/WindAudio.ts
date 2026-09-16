/**
 * WindAudio.ts - Spatial wind noise generation for convertible mode
 * Creates procedural wind noise that varies with car speed
 */

import { createBrowserAudioContext } from '../audio/createAudioContext';
import { cabinAudioPanFromHeadYaw } from '../car/carSpatialModel';
import { signedAngleDiff } from '../utils/navigation';
import { loadWasmModule, type StreetViewWasmAPI } from '../wasm';

/** Taps per ear — short, this is a directional shadow model, not a reverb tail. */
const HRTF_TAPS = 32;

/**
 * Minimum heading change (degrees) before rebuilding the HRTF ConvolverNode
 * buffers. `setHeadingPan` runs every frame; without this a straight-line
 * drive would churn a fresh pair of AudioBuffers every frame for azimuth
 * jitter nobody can hear.
 */
const HRTF_REBUILD_THRESHOLD_DEG = 2;

export interface WindAudioConfig {
  baseVolume: number;
  maxVolume: number;
  minSpeed: number; // km/h where wind starts
  maxSpeed: number; // km/h where wind is at max
  turbulence: number; // 0-1, how much variation in wind sound
}

export class WindAudio {
  private audioContext: AudioContext | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private isActive: boolean = false;
  private currentSpeed: number = 0;
  private targetVolume: number = 0;
  private pendingPan: number = 0;
  private config: WindAudioConfig;

  // Binaural (HRTF) path — replaces the StereoPannerNode pan above once the
  // WASM module has loaded. pannerNode above stays wired as the fallback for
  // the pre-load window and for browsers where building this graph throws.
  private wasm: StreetViewWasmAPI | null = null;
  private convolverL: ConvolverNode | null = null;
  private convolverR: ConvolverNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private lastHrtfAzimuthDeg = 0;
  /** The in-flight (or settled) upgrade started by init(); tests await this. */
  private hrtfUpgrade: Promise<void> | null = null;

  // Default configuration
  private static readonly DEFAULT_CONFIG: WindAudioConfig = {
    baseVolume: 0.05,
    maxVolume: 0.4,
    minSpeed: 10, // Wind starts at 10 km/h
    maxSpeed: 100, // Max wind at 100 km/h
    turbulence: 0.3,
  };

  constructor(config: Partial<WindAudioConfig> = {}) {
    this.config = { ...WindAudio.DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the audio context and create noise buffer
   */
  async init(): Promise<boolean> {
    try {
      if (!this.audioContext) {
        this.audioContext = createBrowserAudioContext();
      }

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0; // Start silent

      this.pannerNode = this.audioContext.createStereoPanner();
      this.pannerNode.pan.value = this.pendingPan;
      this.gainNode.connect(this.pannerNode);
      this.pannerNode.connect(this.audioContext.destination);

      // Create filter for wind effect (lowpass that opens with speed)
      this.filterNode = this.audioContext.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.value = 200;
      this.filterNode.connect(this.gainNode);

      // Fire-and-forget: audio works on the panner path immediately above;
      // this upgrades the graph to real binaural convolution once WASM (or
      // its JS fallback) has loaded.
      this.hrtfUpgrade = this.upgradeToHrtf();

      return true;
    } catch (e) {
      console.error('WindAudio init failed:', e);
      return false;
    }
  }

  /**
   * Replace the StereoPannerNode pan with two ConvolverNodes (one per ear),
   * fed by the same gain stage and recombined into a stereo pair via a
   * ChannelMergerNode. Left as the panner path (no-op) if this throws for any
   * reason — the fallback the acceptance criteria call for when the AudioContext
   * doesn't support what this needs.
   */
  private async upgradeToHrtf(): Promise<void> {
    try {
      const wasm = await loadWasmModule();
      const ctx = this.audioContext;
      if (!ctx || !this.gainNode || !this.pannerNode) return;

      const convolverL = ctx.createConvolver();
      const convolverR = ctx.createConvolver();
      // The spec's auto-normalize scales the IR by a formula unrelated to the
      // interaural level difference fill_hrtf computed — it would flatten the
      // exact gains that make the far ear quieter than the near ear.
      convolverL.normalize = false;
      convolverR.normalize = false;
      const merger = ctx.createChannelMerger(2);

      this.wasm = wasm;
      this.convolverL = convolverL;
      this.convolverR = convolverR;
      this.merger = merger;
      // Centered IR pair up front so the graph is never silently silent
      // between here and the next setHeadingPan() call.
      this.buildHrtfBuffers(0);

      this.gainNode.connect(convolverL);
      this.gainNode.connect(convolverR);
      convolverL.connect(merger, 0, 0);
      convolverR.connect(merger, 0, 1);
      merger.connect(ctx.destination);

      this.gainNode.disconnect(this.pannerNode);
      this.pannerNode.disconnect(ctx.destination);
    } catch (e) {
      console.warn('[WindAudio] HRTF convolver upgrade failed; staying on StereoPannerNode pan', e);
      this.convolverL = null;
      this.convolverR = null;
      this.merger = null;
    }
  }

  /**
   * Resolves once the HRTF convolver upgrade started by init() has settled
   * (built, or fell back to the panner path). init()/setHeadingPan() never
   * need this — it exists for tests/warmup, same as WasmNoiseFeeder.waitUntilLoaded().
   */
  async waitUntilHrtfReady(): Promise<void> {
    await this.hrtfUpgrade;
  }

  /** Fill both ConvolverNode buffers from `fill_hrtf` (or its JS twin) for `azimuthDeg`. */
  private buildHrtfBuffers(azimuthDeg: number): void {
    const ctx = this.audioContext;
    const wasm = this.wasm;
    if (!ctx || !wasm || !this.convolverL || !this.convolverR) return;
    this.lastHrtfAzimuthDeg = azimuthDeg;

    const sampleRate = ctx.sampleRate;
    const left = new Float32Array(HRTF_TAPS);
    const right = new Float32Array(HRTF_TAPS);
    wasm.fillHrtf(left, right, HRTF_TAPS, azimuthDeg, sampleRate);

    const leftBuffer = ctx.createBuffer(1, HRTF_TAPS, sampleRate);
    leftBuffer.copyToChannel(left, 0);
    const rightBuffer = ctx.createBuffer(1, HRTF_TAPS, sampleRate);
    rightBuffer.copyToChannel(right, 0);
    this.convolverL.buffer = leftBuffer;
    this.convolverR.buffer = rightBuffer;
  }

  /**
   * Create pink noise buffer for wind sound
   */
  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.audioContext) return null;

    const bufferSize = 2 * this.audioContext.sampleRate; // 2 seconds
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);

    // Pink noise generation (approximation)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11; // Normalize roughly to -1..1
      b6 = white * 0.115926;
    }

    return buffer;
  }

  /**
   * Start wind noise
   */
  async start(): Promise<void> {
    if (this.isActive || !this.audioContext) return;

    try {
      // Resume context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create and start noise source
      const noiseBuffer = this.createNoiseBuffer();
      if (!noiseBuffer) return;

      this.noiseNode = this.audioContext.createBufferSource();
      this.noiseNode.buffer = noiseBuffer;
      this.noiseNode.loop = true;
      this.noiseNode.connect(this.filterNode!);
      this.noiseNode.start();

      this.isActive = true;
    } catch (e) {
      console.error('WindAudio start failed:', e);
    }
  }

  /**
   * Stop wind noise
   */
  stop(): void {
    if (!this.isActive || !this.noiseNode) return;

    try {
      // Fade out
      if (this.gainNode && this.audioContext) {
        const fadeOut = this.audioContext.currentTime + 0.5;
        this.gainNode.gain.exponentialRampToValueAtTime(0.001, fadeOut);

        setTimeout(() => {
          this.noiseNode?.stop();
          this.noiseNode?.disconnect();
          this.noiseNode = null;
        }, 500);
      }

      this.isActive = false;
    } catch (e) {
      console.error('WindAudio stop failed:', e);
    }
  }

  /**
   * Update wind sound based on car speed
   * @param speed - Car speed in km/h
   */
  update(speed: number): void {
    if (!this.isActive || !this.audioContext || !this.gainNode || !this.filterNode) return;

    this.currentSpeed = speed;

    // Calculate target volume based on speed
    const { minSpeed, maxSpeed, baseVolume, maxVolume } = this.config;

    let normalizedSpeed: number;
    if (speed <= minSpeed) {
      normalizedSpeed = 0;
    } else if (speed >= maxSpeed) {
      normalizedSpeed = 1;
    } else {
      normalizedSpeed = (speed - minSpeed) / (maxSpeed - minSpeed);
    }

    // Exponential curve for more realistic wind
    const volumeCurve = Math.pow(normalizedSpeed, 1.5);
    this.targetVolume = baseVolume + (maxVolume - baseVolume) * volumeCurve;

    // Add turbulence variation
    if (this.config.turbulence > 0 && normalizedSpeed > 0) {
      const turbulence = (Math.random() - 0.5) * this.config.turbulence * 0.2;
      this.targetVolume = Math.max(0, Math.min(1, this.targetVolume + turbulence));
    }

    // Apply volume with smooth transition
    const now = this.audioContext.currentTime;
    this.gainNode.gain.setTargetAtTime(this.targetVolume, now, 0.1);

    // Update filter frequency based on speed (higher speed = higher frequency)
    const minFreq = 200;
    const maxFreq = 2000;
    const targetFreq = minFreq + (maxFreq - minFreq) * normalizedSpeed;
    this.filterNode.frequency.setTargetAtTime(targetFreq, now, 0.1);
  }

  /**
   * Set turbulence amount
   */
  setTurbulence(turbulence: number): void {
    this.config.turbulence = Math.max(0, Math.min(1, turbulence));
  }

  /**
   * Heading-relative binaural pan. Drives the HRTF ConvolverNode pair once
   * `upgradeToHrtf()` has completed; always also updates the StereoPannerNode
   * (cheap, and it's what's actually connected until/unless the upgrade
   * succeeds).
   */
  setHeadingPan(headHeading: number, carHeading: number): void {
    const pan = cabinAudioPanFromHeadYaw(headHeading, carHeading);
    this.pendingPan = pan;
    if (this.pannerNode && this.audioContext) {
      this.pannerNode.pan.setTargetAtTime(pan, this.audioContext.currentTime, 0.08);
    }

    if (this.convolverL && this.convolverR) {
      // Same sign convention as cabinAudioPanFromHeadYaw: positive = looking
      // right of the car body, which fill_hrtf treats as "toward the right ear".
      const azimuthDeg = signedAngleDiff(headHeading, carHeading);
      if (Math.abs(azimuthDeg - this.lastHrtfAzimuthDeg) >= HRTF_REBUILD_THRESHOLD_DEG) {
        this.buildHrtfBuffers(azimuthDeg);
      }
    }
  }

  /**
   * Check if wind audio is currently active
   */
  isPlaying(): boolean {
    return this.isActive;
  }

  /**
   * Get current speed
   */
  getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    if (this.filterNode) {
      this.filterNode.disconnect();
      this.filterNode = null;
    }

    if (this.convolverL) {
      this.convolverL.disconnect();
      this.convolverL = null;
    }
    if (this.convolverR) {
      this.convolverR.disconnect();
      this.convolverR = null;
    }
    if (this.merger) {
      this.merger.disconnect();
      this.merger = null;
    }

    if (this.pannerNode) {
      this.pannerNode.disconnect();
      this.pannerNode = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.wasm = null;
    this.lastHrtfAzimuthDeg = 0;
    this.hrtfUpgrade = null;
  }
}

// Singleton instance for global wind audio management
let globalWindAudio: WindAudio | null = null;

/**
 * Get or create global wind audio instance
 */
export function getWindAudio(): WindAudio {
  if (!globalWindAudio) {
    globalWindAudio = new WindAudio();
  }
  return globalWindAudio;
}

/**
 * Initialize wind audio system
 */
export async function initWindAudio(): Promise<boolean> {
  return getWindAudio().init();
}

/**
 * Dispose wind audio system
 */
export function disposeWindAudio(): void {
  globalWindAudio?.dispose();
  globalWindAudio = null;
}

export default WindAudio;
