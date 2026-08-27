/**
 * WindAudio.ts - Spatial wind noise generation for convertible mode
 * Creates procedural wind noise that varies with car speed
 */

import { createBrowserAudioContext } from '../audio/createAudioContext';
import { cabinAudioPanFromHeadYaw } from '../car/carSpatialModel';

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

      return true;
    } catch (e) {
      console.error('WindAudio init failed:', e);
      return false;
    }
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
   * Heading-relative stereo pan (Web Audio StereoPannerNode). Not HRTF.
   */
  setHeadingPan(headHeading: number, carHeading: number): void {
    const pan = cabinAudioPanFromHeadYaw(headHeading, carHeading);
    this.pendingPan = pan;
    if (this.pannerNode && this.audioContext) {
      this.pannerNode.pan.setTargetAtTime(pan, this.audioContext.currentTime, 0.08);
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
