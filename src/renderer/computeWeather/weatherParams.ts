import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from '../weatherUniformLayout';
import { createDefaultWeatherParams } from '../packWeatherParams';

/**
 * The shared 40-float weather parameter block (binding 10).
 *
 * Every mutation flushes the whole array to the GPU, which is what the
 * original code did at each setter — cheap enough at 160 bytes, and it keeps
 * "the buffer always matches the array" true without tracking dirty ranges.
 * The layout itself is owned by `weatherUniformLayout.ts` and shared with the
 * fragment path; this class only owns the CPU-side copy and the upload.
 */
export class WeatherParamBlock {
    private readonly values = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    private readonly startTime = Date.now();

    constructor(
        private readonly device: GPUDevice,
        private getBuffer: () => GPUBuffer | null,
    ) {
        this.values.set(createDefaultWeatherParams());
        this.flush();
    }

    /** Read-only view for callers that need to inspect the block (e.g. particles). */
    public raw(): Float32Array {
        return this.values;
    }

    public get(index: number): number {
        return this.values[index] ?? 0;
    }

    public flush(): void {
        const buffer = this.getBuffer();
        if (!buffer || !this.device) return;
        this.device.queue.writeBuffer(buffer, 0, this.values);
    }

    public setShaderEffects(enabled: boolean): void {
        this.values[WeatherParamIndex.shaderEffectsEnabled] = enabled ? 1.0 : 0.0;
        this.flush();
    }

    public setAll(params: Float32Array): void {
        this.values.set(params.subarray(0, Math.min(WEATHER_PARAMS_FLOAT_COUNT, params.length)));
        this.flush();
    }

    public setCamera(heading: number, pitch: number): void {
        this.values[WeatherParamIndex.cameraHeading] = heading;
        this.values[WeatherParamIndex.cameraPitch] = pitch;
        this.flush();
    }

    /** The first six floats are the colour-grading chain. */
    public setColor(params: Float32Array): void {
        this.values.set(params.slice(0, 6), 0);
        this.flush();
    }

    public getCamera(): { heading: number; pitch: number } {
        return {
            heading: this.values[WeatherParamIndex.cameraHeading]!,
            pitch: this.values[WeatherParamIndex.cameraPitch]!,
        };
    }

    /** Advance shader time. Wraps at 10000s to stay inside f32 sin/hash precision. */
    public tick(): void {
        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.values[WeatherParamIndex.time] = time % 10000.0;
            this.flush();
        } catch {
            // Ignore errors during weather-only updates
        }
    }

    public getTime(): number {
        return this.values[WeatherParamIndex.time] ?? 0;
    }
}
