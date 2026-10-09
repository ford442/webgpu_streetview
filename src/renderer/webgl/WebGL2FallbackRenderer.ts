/**
 * Opt-in WebGL2 post-process renderer — `?webgl2=1` only.
 *
 * WebGPU stays required by default: `createStreetViewRenderer` constructs this
 * class only when WebGPU failed AND the flag is set, and the app then shows a
 * persistent "WebGL2 fallback active" banner. SDR approximation: no compute
 * weather, LUTs, temporal history, GPU snapshots, or one-frame cabin compositor.
 * Shaders come from `weatherReference.glsl.ts` (parity-tested against WGSL).
 */
import { RenderMode } from '../types';
import {
    RendererDebugOptions,
    RendererEffectIsolation,
    StreetViewRenderer,
} from '../RendererBackend';
import { getCanvasFingerprint } from '../../utils/panoramaStability';
import {
    WEATHER_PARAMS_FLOAT_COUNT,
    WeatherParamIndex,
} from '../weatherUniformLayout';
import { createDefaultWeatherParams } from '../packWeatherParams';
import { WEBGL_WEATHER_FRAGMENT_GLSL, WEBGL_WEATHER_VERTEX_GLSL } from './weatherReference.glsl';

function effectIsolationToUniform(effect: RendererEffectIsolation): number {
    switch (effect) {
        case 'raw': return 1;
        case 'color': return 2;
        case 'weather': return 3;
        case 'fog': return 4;
        case 'night': return 5;
        case 'lighting': return 6;
        case 'all':
        default:
            return 0;
    }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
        gl.deleteShader(shader);
        throw new Error(log);
    }
    return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, WEBGL_WEATHER_VERTEX_GLSL);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, WEBGL_WEATHER_FRAGMENT_GLSL);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || 'unknown program link error';
        gl.deleteProgram(program);
        throw new Error(log);
    }

    return program;
}

export class WebGL2FallbackRenderer implements StreetViewRenderer {
    public readonly canvas: HTMLCanvasElement;
    public readonly backendType = 'webgl' as const;
    public readonly fallbackReason?: string;

    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private texture: WebGLTexture | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private weatherParams = createDefaultWeatherParams();
    private startTime = Date.now();
    private shaderEffectsEnabled = true;
    private debugOptions: RendererDebugOptions;
    private lastSource: CanvasImageSource | null = null;
    private lastUploadWidth = 0;
    private lastUploadHeight = 0;
    private holdActive = false;
    private transitionProgress = 1.0;
    private cameraParams = { heading: 0, pitch: 0 };

    private uScene: WebGLUniformLocation | null = null;
    private uWeather: WebGLUniformLocation | null = null;
    private uView: WebGLUniformLocation | null = null;
    private uEffectIsolation: WebGLUniformLocation | null = null;
    private uWireframe: WebGLUniformLocation | null = null;

    constructor(canvas: HTMLCanvasElement, debugOptions: RendererDebugOptions, fallbackReason?: string) {
        this.canvas = canvas;
        this.debugOptions = debugOptions;
        this.fallbackReason = fallbackReason;
    }

    public async init(): Promise<boolean> {
        try {
            const gl = this.canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
            });
            if (!gl) return false;

            this.gl = gl;
            this.program = createProgram(gl);
            this.vao = gl.createVertexArray();
            this.texture = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

            this.uScene = gl.getUniformLocation(this.program, 'uScene');
            this.uWeather = gl.getUniformLocation(this.program, 'uWeather');
            this.uView = gl.getUniformLocation(this.program, 'uView');
            this.uEffectIsolation = gl.getUniformLocation(this.program, 'uEffectIsolation');
            this.uWireframe = gl.getUniformLocation(this.program, 'uWireframe');

            this.resize(this.canvas.width, this.canvas.height);
            return true;
        } catch (error) {
            console.warn('[WebGL2FallbackRenderer] init failed:', error instanceof Error ? error.message : String(error));
            this.destroy();
            return false;
        }
    }

    public resize(width: number, height: number): void {
        if (!this.gl) return;
        this.gl.viewport(0, 0, Math.max(1, width), Math.max(1, height));
    }

    public destroy(): void {
        const gl = this.gl;
        if (!gl) return;
        if (this.texture) gl.deleteTexture(this.texture);
        if (this.program) gl.deleteProgram(this.program);
        if (this.vao) gl.deleteVertexArray(this.vao);
        this.texture = null;
        this.program = null;
        this.vao = null;
        this.gl = null;
    }

    public setCarMode(_active: boolean): void {
        // Car compositing is still handled by the existing Three.js overlay canvas.
    }

    public updateEffects(effectsData: Float32Array): void {
        if (effectsData.length > 8) {
            this.weatherParams[WeatherParamIndex.shaderEffectsEnabled] =
                effectsData[8]! || this.weatherParams[WeatherParamIndex.shaderEffectsEnabled]!;
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    public getOutputCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        this.weatherParams[WeatherParamIndex.shaderEffectsEnabled] = enabled ? 1.0 : 0.0;
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.cameraParams;
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public updateWeatherParams(params: Float32Array): void {
        this.weatherParams.set(params.subarray(0, Math.min(WEATHER_PARAMS_FLOAT_COUNT, params.length)));
        this.shaderEffectsEnabled = this.weatherParams[WeatherParamIndex.shaderEffectsEnabled]! >= 0.5;
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.weatherParams[WeatherParamIndex.cameraHeading] = heading;
        this.weatherParams[WeatherParamIndex.cameraPitch] = pitch;
        this.cameraParams = { heading, pitch };
    }

    public updateColorParams(params: Float32Array): void {
        this.weatherParams.set(params.subarray(0, Math.min(6, params.length)), 0);
    }

    public updateNoiseBuffer(_tile: Float32Array): void {
        // The WebGL fallback pipeline doesn't sample the WASM noise tile —
        // it's a WebGPU-only enhancement layered on weather-post.wgsl.
    }

    public updateParticleSeeds(_seeds: Float32Array, _width: number, _height: number): void {
        // WebGL fallback stays procedural; no compute particle textures.
    }

    public setLookLut(_volume: import('../lut').LutVolume | null): void {
        // WebGL keeps the 6-knob look approximation — no 3D LUT, no second lighting model.
    }

    public setTemporalHistoryEnabled(_enabled: boolean): void {
        // TAA/DOF history is compute-only.
    }

    public updateWeatherAnimation(): void {
        this.weatherParams[WeatherParamIndex.time] = ((Date.now() - this.startTime) / 1000) % 10000.0;
        if (this.lastSource) {
            this.draw(1.0, 0.5, 0.5);
        } else {
            this.renderWeatherOnly();
        }
    }

    public renderWeatherOnly(): void {
        const gl = this.gl;
        if (!gl) return;
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    public beginTransition(_mode: string = 'zoom'): void {
        this.transitionProgress = 0.0;
    }

    public capturePanorama(_movementHeading: number): void {
        // WebGL fallback does not GPU-snapshot panoramas yet; StreetViewProvider
        // still supplies its CPU-side transitionSource during navigation.
    }

    public updateTransitionProgress(progress: number): void {
        this.transitionProgress = progress;
    }

    public endTransition(): void {
        this.transitionProgress = 1.0;
    }

    public isInTransition(): boolean {
        return this.transitionProgress > 0.0 && this.transitionProgress < 1.0;
    }

    public getTransitionDuration(_mode?: string): number {
        return 450;
    }

    public captureCurrentFrame(): void {
        // See capturePanorama note.
    }

    public beginHoldTransition(_heading?: number, _pitch?: number, _cpuSnapshot?: HTMLCanvasElement): void {
        this.holdActive = true;
        this.transitionProgress = 0.0;
    }

    public endHoldTransition(): void {
        this.holdActive = false;
    }

    public isHoldActive(): boolean {
        return this.holdActive;
    }

    public setTransitionProgress(progress: number): void {
        this.transitionProgress = progress;
    }

    public renderHeldFrame(heading?: number, pitch?: number, zoom?: number): void {
        if (!this.holdActive || !this.lastSource) {
            this.renderWeatherOnly();
            return;
        }
        this.draw(zoom || 1.0, ((heading || 0) % 360) / 360, ((pitch || 0) + 90) / 180);
    }

    public setDebugOptions(options: Partial<RendererDebugOptions>): void {
        this.debugOptions = { ...this.debugOptions, ...options };
    }

    public renderStreetView(
        _mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void {
        const gl = this.gl;
        if (!gl || !this.texture) return;

        if (this.holdActive) {
            this.renderHeldFrame(heading, pitch, zoom);
            return;
        }

        if (source) {
            const width = source instanceof HTMLCanvasElement
                ? source.width
                : source instanceof HTMLVideoElement
                    ? source.videoWidth
                    : source instanceof ImageBitmap
                        ? source.width
                        : 0;
            const height = source instanceof HTMLCanvasElement
                ? source.height
                : source instanceof HTMLVideoElement
                    ? source.videoHeight
                    : source instanceof ImageBitmap
                        ? source.height
                        : 0;

            const stable = !(source instanceof HTMLCanvasElement) || !!getCanvasFingerprint(source);
            if (width > 0 && height > 0 && stable) {
                try {
                    gl.bindTexture(gl.TEXTURE_2D, this.texture);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
                    this.lastSource = source;
                    this.lastUploadWidth = width;
                    this.lastUploadHeight = height;
                } catch {
                    // Keep the previous valid texture on transient Google canvas copy failures.
                }
            }
        }

        if (!this.lastSource && this.lastUploadWidth === 0 && this.lastUploadHeight === 0) {
            this.renderWeatherOnly();
            return;
        }

        this.draw(zoom || 1.0, ((heading || 0) % 360) / 360, ((pitch || 0) + 90) / 180);
    }

    private draw(zoom: number, panX: number, panY: number): void {
        const gl = this.gl;
        if (!gl || !this.program || !this.texture) return;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        if (this.uScene) gl.uniform1i(this.uScene, 0);
        if (this.uWeather) gl.uniform1fv(this.uWeather, this.weatherParams);
        if (this.uView) gl.uniform4f(this.uView, zoom, panX, panY, this.transitionProgress);
        if (this.uEffectIsolation) gl.uniform1i(this.uEffectIsolation, effectIsolationToUniform(this.debugOptions.effectIsolation));
        if (this.uWireframe) gl.uniform1i(this.uWireframe, this.debugOptions.wireframe ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }
}
