/**
 * SelectivePostProcessing - Post-processing pipeline that applies effects only to
 * the Street View background, excluding the car interior.
 * 
 * Manages WGSL shader uniforms for rain, sunset, vignette, and night mode effects
 * that are applied through the existing WebGPU rendering pipeline.
 */

export interface PostProcessingSettings {
    rainIntensity: number;    // 0.0 - 1.0
    timeOfDay: 'day' | 'sunset' | 'night';
    vignetteStrength: number; // 0.0 - 1.0
    nightMode: boolean;
}

const DEFAULT_SETTINGS: PostProcessingSettings = {
    rainIntensity: 0.0,
    timeOfDay: 'day',
    vignetteStrength: 0.3,
    nightMode: false,
};

/**
 * Get the color grading parameters for each time of day.
 */
function getTimeOfDayParams(timeOfDay: 'day' | 'sunset' | 'night'): { tint: [number, number, number]; brightness: number; contrast: number } {
    switch (timeOfDay) {
        case 'sunset':
            return { tint: [1.2, 0.85, 0.7], brightness: 0.95, contrast: 1.1 };
        case 'night':
            return { tint: [0.4, 0.45, 0.6], brightness: 0.3, contrast: 1.3 };
        case 'day':
        default:
            return { tint: [1.0, 1.0, 1.0], brightness: 1.0, contrast: 1.0 };
    }
}

export class SelectivePostProcessing {
    private settings: PostProcessingSettings;

    constructor() {
        this.settings = { ...DEFAULT_SETTINGS };
    }

    /**
     * Update post-processing settings.
     */
    public setSettings(partial: Partial<PostProcessingSettings>): void {
        this.settings = { ...this.settings, ...partial };
    }

    /**
     * Get current settings.
     */
    public getSettings(): PostProcessingSettings {
        return { ...this.settings };
    }

    /**
     * Get the packed uniform data for the post-processing shader.
     * Returns a Float32Array suitable for uploading to a GPU uniform buffer.
     * Layout: [rainIntensity, vignetteStrength, brightness, contrast, 
     *          tintR, tintG, tintB, nightMode]
     */
    public getUniformData(): Float32Array {
        const todParams = getTimeOfDayParams(this.settings.timeOfDay);
        return new Float32Array([
            this.settings.rainIntensity,
            this.settings.vignetteStrength,
            todParams.brightness,
            todParams.contrast,
            todParams.tint[0],
            todParams.tint[1],
            todParams.tint[2],
            this.settings.nightMode ? 1.0 : 0.0,
        ]);
    }

    /**
     * Set rain intensity (0-100 from slider, normalized to 0-1).
     */
    public setRainIntensity(value: number): void {
        this.settings.rainIntensity = Math.max(0, Math.min(1, value / 100));
    }

    /**
     * Set time of day mode.
     */
    public setTimeOfDay(value: 'day' | 'sunset' | 'night'): void {
        this.settings.timeOfDay = value;
    }

    /**
     * Toggle night mode.
     */
    public toggleNightMode(): void {
        this.settings.nightMode = !this.settings.nightMode;
        if (this.settings.nightMode) {
            this.settings.timeOfDay = 'night';
        }
    }

    /**
     * Clean up resources.
     */
    public dispose(): void {
        // Reset to defaults
        this.settings = { ...DEFAULT_SETTINGS };
    }
}
