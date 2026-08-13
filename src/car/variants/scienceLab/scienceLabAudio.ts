export class ScienceLabAudio {
    audioContext: AudioContext | null = null;
    fanOscillator: OscillatorNode | null = null;
    fanGain: GainNode | null = null;

    init(): void {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.startEquipmentSounds();
        } catch (e) {
            console.warn('Audio not available for lab equipment:', e);
        }
    }

    startEquipmentSounds(): void {
        if (!this.audioContext) return;

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
        this.fanGain.connect(this.audioContext.destination);

        this.fanOscillator.start();
    }

    playBeep(frequency: number = 800, duration: number = 0.1): void {
        if (!this.audioContext) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

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
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.fanOscillator = null;
        this.fanGain = null;
        this.audioContext = null;
    }
}
