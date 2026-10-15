/**
 * Fixture page for e2e/cabin-audio.spec.ts.
 *
 * Builds the production cabin audio path in a real AudioContext: `CabinAudio`
 * (the WASM engine in its AudioWorklet, the binary chosen by the real SIMD
 * probe and `?cabinDsp`), the shared car graph, and a stand-in radio — a
 * square-wave oscillator on the real radio bus, so it is deterministic and
 * needs no network. The click on #start (once it carries data-armed) is the
 * user gesture Web Audio wants.
 *
 * window.__cabin:
 *   ready: Promise<void>            resolves once the probe reports ready
 *   drive(over)                      post telemetry/occlusion/environment
 *   radio(on)                        connect / disconnect the stand-in radio
 *   measure(ms)                      RMS and the 4–12 kHz share of the
 *                                    post-cabin tap (the dash visualiser's)
 *   currentTime()                    the audio clock
 */
import { CabinAudio } from '/src/car/audio/CabinAudio';
import { acquireCarAudioGraph } from '/src/audio/carAudioGraph';
import type { VehicleType } from '/src/car/VehicleManager';

interface DriveInput {
  speedKmh?: number;
  rpm?: number;
  accelerating?: boolean;
  openness?: number;
  vehicle?: VehicleType;
  rainIntensity?: number;
  wind?: number;
  wipersEnabled?: boolean;
}

declare global {
  interface Window {
    __cabin?: {
      ready: Promise<void>;
      drive(input: DriveInput): void;
      radio(on: boolean): void;
      measure(ms: number): Promise<{ rms: number; hfShare: number }>;
      currentTime(): number;
    };
  }
}

const startButton = document.getElementById('start')!;
startButton.addEventListener('click', () => {
  const audio = new CabinAudio();
  const graph = acquireCarAudioGraph()!;
  const ctx = graph.ctx;
  let radioOsc: OscillatorNode | null = null;
  let last: DriveInput = {};

  const drive = (input: DriveInput): void => {
    last = { ...last, ...input };
    audio.update(
      {
        speedKmh: last.speedKmh ?? 0,
        rpm: last.rpm ?? 850,
        gear: 'D',
        accelerating: last.accelerating ?? false,
      },
      { openness: last.openness ?? 0, vehicle: last.vehicle ?? 'sedan' },
      {
        rainIntensity: last.rainIntensity ?? 0,
        wind: last.wind ?? 0,
        wipersEnabled: last.wipersEnabled ?? false,
      },
    );
  };

  const ready = (async () => {
    await ctx.resume();
    await audio.start();
    drive({});
    for (let i = 0; i < 400; i++) {
      if (window.__CABIN_AUDIO_PROBE__?.ready) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`cabin engine never became ready: ${JSON.stringify(window.__CABIN_AUDIO_PROBE__)}`);
  })();

  const measure = async (ms: number): Promise<{ rms: number; hfShare: number }> => {
    const analyser = graph.analyser;
    analyser.fftSize = 2048;
    const time = new Float32Array(analyser.fftSize);
    const freq = new Float32Array(analyser.frequencyBinCount);
    const binHz = ctx.sampleRate / analyser.fftSize;
    let sumSq = 0;
    let n = 0;
    let hf = 0;
    let total = 0;
    const until = performance.now() + ms;
    while (performance.now() < until) {
      analyser.getFloatTimeDomainData(time);
      for (const v of time) sumSq += v * v;
      n += time.length;
      analyser.getFloatFrequencyData(freq);
      for (let i = 1; i < freq.length; i++) {
        const p = 10 ** (freq[i]! / 10);
        total += p;
        const hz = i * binHz;
        if (hz >= 4000 && hz <= 12000) hf += p;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return { rms: Math.sqrt(sumSq / Math.max(1, n)), hfShare: total > 0 ? hf / total : 0 };
  };

  window.__cabin = {
    ready,
    drive,
    radio(on: boolean): void {
      if (on && !radioOsc) {
        radioOsc = ctx.createOscillator();
        radioOsc.type = 'square';
        radioOsc.frequency.value = 1500;
        const level = ctx.createGain();
        level.gain.value = 0.3;
        radioOsc.connect(level).connect(graph.radioBus);
        radioOsc.start();
      } else if (!on && radioOsc) {
        radioOsc.stop();
        radioOsc.disconnect();
        radioOsc = null;
      }
    },
    measure,
    currentTime: () => ctx.currentTime,
  };
  startButton.textContent = 'started';
});
// The spec clicks only once the handler is attached.
startButton.dataset.armed = '1';
