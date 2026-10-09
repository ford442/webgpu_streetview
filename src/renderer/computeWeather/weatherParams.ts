import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from '../weatherUniformLayout';
import { createDefaultWeatherParams } from '../packWeatherParams';

/**
 * The shared 44-float weather parameter block (binding 10).
 *
 * Setters only mark the block dirty; `flush()` uploads the whole array once,
 * and the post-processor calls it right before it encodes a dispatch. That is
 * one `writeBuffer` per rendered frame instead of one per setter (the canvas
 * sets params, camera and time every frame), and "the buffer matches the
 * array" still holds for every dispatch that reads it.
 * The layout itself is owned by `weatherUniformLayout.ts` and shared with the
 * fragment path; this class only owns the CPU-side copy and the upload.
 */
export class WeatherParamBlock {
    private readonly values = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    private readonly startTime = Date.now();
    private dirty = true;

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

    /** Upload the block if any setter ran since the last upload. */
    public flush(): void {
        if (!this.dirty) return;
        const buffer = this.getBuffer();
        if (!buffer || !this.device) return;
        this.device.queue.writeBuffer(buffer, 0, this.values);
        this.dirty = false;
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public setShaderEffects(enabled: boolean): void {
        this.values[WeatherParamIndex.shaderEffectsEnabled] = enabled ? 1.0 : 0.0;
        this.dirty = true;
    }

    public setAll(params: Float32Array): void {
        this.values.set(params.subarray(0, Math.min(WEATHER_PARAMS_FLOAT_COUNT, params.length)));
        this.dirty = true;
    }

    public setCamera(heading: number, pitch: number): void {
        this.values[WeatherParamIndex.cameraHeading] = heading;
        this.values[WeatherParamIndex.cameraPitch] = pitch;
        this.dirty = true;
    }

    /** The first six floats are the colour-grading chain. */
    public setColor(params: Float32Array): void {
        this.values.set(params.slice(0, 6), 0);
        this.dirty = true;
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
            this.dirty = true;
        } catch {
            // Ignore errors during weather-only updates
        }
    }

    public getTime(): number {
        return this.values[WeatherParamIndex.time] ?? 0;
    }
}
