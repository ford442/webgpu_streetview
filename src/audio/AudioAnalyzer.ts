/**
 * AudioAnalyzer: Captures audio from a stream, computes FFT, and exposes frequency bands.
 * Designed to work with remote audio streams and local Web Audio API.
 */

export interface AudioFrequencyData {
  bass: number;         // 0..1 (20Hz - 250Hz)
  lowMid: number;       // 0..1 (250Hz - 500Hz)
  mid: number;          // 0..1 (500Hz - 2kHz)
  highMid: number;      // 0..1 (2kHz - 4kHz)
  high: number;         // 0..1 (4kHz - 20kHz)
  overall: number;      // 0..1 average of all bands
  rawBuffer: Uint8Array; // full FFT output
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  // correct DOM type for a media-element based audio source
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private isRunning: boolean = false;
  private audioElement: HTMLAudioElement | null = null;
  
  // Public getters for accessing audio nodes
  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }
  
  public getAudioElement(): HTMLAudioElement | null {
    return this.audioElement;
  }

  /**
   * Initialize audio capture from a stream URL (CORS-enabled remote stream or local audio)
   * Uses a hidden audio element to capture the stream via Web Audio API.
   */
  async init(streamUrl: string): Promise<boolean> {
    try {
      // Create an audio context if one doesn't exist
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Create hidden audio element
      if (!this.audioElement) {
        this.audioElement = document.createElement('audio');
        this.audioElement.crossOrigin = 'anonymous';
        this.audioElement.loop = true;
        this.audioElement.style.display = 'none';
        document.body.appendChild(this.audioElement);
      }

      // Assign the stream to the audio element
      this.audioElement.src = streamUrl;

      // Create analyser
      if (!this.analyser) {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256; // trade-off between frequency resolution and performance
      }

      // Connect audio element to analyser
      if (!this.mediaSource) {
        // use createMediaElementSource (standard) to create a MediaElementAudioSourceNode
        this.mediaSource = this.audioContext.createMediaElementSource(this.audioElement);
        this.mediaSource.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
      }

      // Allocate FFT output buffer
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      // Resume audio context if suspended (common on mobile)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      return true;
    } catch (e) {
      console.error('AudioAnalyzer init failed:', e);
      return false;
    }
  }

  /**
   * Start audio playback and analysis
   */
  async start(): Promise<void> {
    if (!this.audioElement) return;
    try {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      await this.audioElement.play();
      this.isRunning = true;
    } catch (e) {
      console.error('AudioAnalyzer start failed:', e);
    }
  }

  /**
   * Stop audio playback
   */
  stop(): void {
    if (!this.audioElement) return;
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.isRunning = false;
  }

  /**
   * Get current frequency data (must call frequently, e.g. in animation loop)
   */
  getFrequencyData(): AudioFrequencyData {
    const defaultData: AudioFrequencyData = {
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      high: 0,
      overall: 0,
      rawBuffer: new Uint8Array(0),
    };

    if (!this.analyser || !this.dataArray || !this.isRunning) {
      return defaultData;
    }

    // Capture frequency data
    this.analyser.getByteFrequencyData(this.dataArray);

    // Normalize to 0..1 and average bands
    const totalBins = this.dataArray.length;

    // Compute bin counts dynamically based on audio context sample rate (Nyquist = sampleRate/2)
    const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
    const nyquist = sampleRate / 2;
    const bassBins = Math.floor((250 / nyquist) * totalBins); // 0-250Hz
    const lowMidBins = Math.floor((500 / nyquist) * totalBins); // 250-500Hz
    const midBins = Math.floor((2000 / nyquist) * totalBins); // 500-2kHz
    const highMidBins = Math.floor((4000 / nyquist) * totalBins); // 2-4kHz

    // Average each band
    let bass = 0,
      lowMid = 0,
      mid = 0,
      highMid = 0,
      high = 0;

    for (let i = 0; i < bassBins; i++) {
      bass += this.dataArray[i];
    }
    bass /= Math.max(1, bassBins) * 255;

    for (let i = bassBins; i < lowMidBins; i++) {
      lowMid += this.dataArray[i];
    }
    lowMid /= Math.max(1, lowMidBins - bassBins) * 255;

    for (let i = lowMidBins; i < midBins; i++) {
      mid += this.dataArray[i];
    }
    mid /= Math.max(1, midBins - lowMidBins) * 255;

    for (let i = midBins; i < highMidBins; i++) {
      highMid += this.dataArray[i];
    }
    highMid /= Math.max(1, highMidBins - midBins) * 255;

    for (let i = highMidBins; i < totalBins; i++) {
      high += this.dataArray[i];
    }
    high /= Math.max(1, totalBins - highMidBins) * 255;

    const overall = (bass + lowMid + mid + highMid + high) * 0.2;

    return {
      bass,
      lowMid,
      mid,
      highMid,
      high,
      overall,
      rawBuffer: new Uint8Array(this.dataArray),
    };
  }

  /**
   * Cleanup
   */
  dispose(): void {
    if (this.audioElement && this.audioElement.parentNode) {
      this.audioElement.parentNode.removeChild(this.audioElement);
      this.audioElement = null;
    }
    this.mediaSource = null;
    this.analyser = null;
    this.dataArray = null;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
