import { acquireAudioRuntime, releaseAudioRuntime } from '../../../audio/audioRuntime';

/** The lab's fan and beeps, on the shared runtime's `ui` bus (#367). */
export class ScienceLabAudio {
    audioContext: AudioContext | null = null;
    private output: AudioNode | null = null;
    fanOscillator: OscillatorNode | null = null;
    fanGain: GainNode | null = null;

    init(): void {
        try {
            const rt = acquireAudioRuntime();
            if (!rt) throw new Error('Web Audio API is not available');
            this.audioContext = rt.ctx;
            this.output = rt.buses.ui;
            this.startEquipmentSounds();
        } catch (e) {
            console.warn('Audio not available for lab equipment:', e);
        }
    }

    startEquipmentSounds(): void {
        if (!this.audioContext || !this.output) return;

        this.fanOscillator = this.audioContext.createOscillator();
        this.fanGain = this.audioContext.createGain();

        this.fanOscillator.type = 'sawtooth';
        this.fanOscillator.frequency.value = 80;
        this.fanGain.gain.value = 0.03;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 200;

        this.fanOscillator.connect(filter);
        filter.connect(this.fanGain);
        this.fanGain.connect(this.output);

        this.fanOscillator.start();
    }

    playBeep(frequency: number = 800, duration: number = 0.1): void {
        if (!this.audioContext || !this.output) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.output);

        osc.start();
        osc.stop(this.audioContext.currentTime + duration);
    }

    setFanGain(active: boolean): void {
        if (!this.fanGain) return;
        this.fanGain.gain.setTargetAtTime(
            active ? 0.03 : 0,
            this.audioContext?.currentTime || 0,
            0.5
        );
    }

    dispose(): void {
        if (this.fanOscillator) {
            this.fanOscillator.stop();
        }
        this.fanGain?.disconnect();
        if (this.audioContext) {
            // Shared: release, never close.
            releaseAudioRuntime();
        }
        this.fanOscillator = null;
        this.fanGain = null;
        this.audioContext = null;
        this.output = null;
    }
}
