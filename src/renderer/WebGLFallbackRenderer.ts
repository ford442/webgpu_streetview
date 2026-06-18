import { RenderMode } from './types';
import {
    RendererDebugOptions,
    RendererEffectIsolation,
    StreetViewRenderer,
} from './RendererBackend';
import { getCanvasFingerprint } from '../hooks/useStreetView';

const VERTEX_SHADER = `#version 300 es
precision highp float;

const vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
);

out vec2 vUv;

void main() {
    vec2 pos = positions[gl_VertexID];
    gl_Position = vec4(pos, 0.0, 1.0);
    vUv = pos * 0.5 + 0.5;
    vUv.y = 1.0 - vUv.y;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform float uWeather[40];
uniform vec4 uView;
uniform int uEffectIsolation;
uniform bool uWireframe;

in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 applyVibrance(vec3 col, float vibrance) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float maxC = max(max(col.r, col.g), col.b);
    float sat = maxC - luma;
    return col + (col - vec3(luma)) * vibrance * (1.0 - sat);
}

vec3 applySaturation(vec3 col, float saturation) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), col, 1.0 + saturation);
}

vec3 applyTemperatureTint(vec3 col, float temperature, float tint) {
    vec3 warm = vec3(1.0 + max(temperature, 0.0) * 0.22, 1.0, 1.0 - max(temperature, 0.0) * 0.14);
    vec3 cool = vec3(1.0 + min(temperature, 0.0) * 0.12, 1.0, 1.0 - min(temperature, 0.0) * 0.2);
    vec3 tinted = col * mix(cool, warm, step(0.0, temperature));
    tinted.r += tint * 0.04;
    tinted.g -= tint * 0.03;
    return tinted;
}

vec3 applyColorGrade(vec3 col) {
    col = applyVibrance(col, uWeather[0]);
    col = applySaturation(col, uWeather[1]);
    col = (col - 0.5) * (1.0 + uWeather[2]) + 0.5;
    col = applyTemperatureTint(col, uWeather[4], uWeather[5]);
    col *= pow(2.0, uWeather[3]);
    return max(col, vec3(0.0));
}

vec3 applyNight(vec3 col, vec2 uv) {
    float night = clamp(uWeather[11], 0.0, 1.0);
    vec3 nightColor = col * vec3(0.34, 0.42, 0.58);
    col = mix(col, nightColor, night);

    if (uWeather[12] > 0.5) {
        vec2 beamCenter = vec2(uWeather[14], uWeather[15]);
        float beamWidth = mix(0.16, 0.28, clamp(uWeather[13], 0.0, 1.0));
        float beam = smoothstep(beamWidth, 0.0, length((uv - beamCenter) * vec2(1.0, 1.75)));
        col += vec3(1.0, 0.86, 0.55) * beam * (0.28 + 0.28 * night);
    }

    if (uWeather[16] > 0.5) {
        float dome = smoothstep(0.7, 0.0, length(uv - vec2(0.5, 0.18)));
        col += vec3(1.0, 0.72, 0.42) * dome * uWeather[17] * 0.35;
    }

    return col;
}

vec3 applyWeather(vec3 col, vec2 uv) {
    float time = uWeather[6] * max(uWeather[10], 0.2);
    float rain = clamp(uWeather[7], 0.0, 2.0);
    float snow = clamp(uWeather[8], 0.0, 2.0);
    float wind = uWeather[9];

    if (rain > 0.001) {
        vec2 rainUv = uv * vec2(120.0, 34.0) + vec2(wind * time * 10.0, time * 24.0);
        float streak = smoothstep(0.965, 1.0, noise2D(rainUv));
        streak *= smoothstep(0.35, 1.0, fract(rainUv.y));
        col = mix(col, vec3(0.64, 0.78, 0.95), streak * rain * 0.18);
        col *= 1.0 - rain * 0.045;
    }

    if (snow > 0.001) {
        vec2 snowUv = uv * vec2(44.0, 26.0) + vec2(wind * time * 1.2, time * 2.2);
        float flakes = smoothstep(0.986, 1.0, noise2D(snowUv));
        col += vec3(0.95, 0.98, 1.0) * flakes * snow * 0.32;
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), snow * 0.035);
    }

    return col;
}

vec3 applyFogAndLighting(vec3 col, vec2 uv) {
    float fog = clamp(uWeather[22] + uWeather[23] * 0.65, 0.0, 1.0);
    float horizon = smoothstep(1.0, 0.2, abs(uv.y - 0.5));
    col = mix(col, vec3(0.72, 0.76, 0.8), fog * (0.35 + horizon * 0.3));

    float sunVisible = clamp(uWeather[19] / 0.3, 0.0, 1.0);
    float sunX = fract((uWeather[18] + 3.14159265) / 6.2831853 - uWeather[33] + 0.5);
    vec2 sunPos = vec2(sunX, clamp(0.5 - uWeather[19] * 0.9, 0.02, 0.98));
    float lens = smoothstep(0.6, 0.0, length((uv - sunPos) * vec2(1.6, 1.0)));
    col += vec3(1.0, 0.78, 0.44) * lens * sunVisible * uWeather[28] * 0.35;

    float shaft = smoothstep(0.42, 0.0, abs(uv.x - sunPos.x)) * smoothstep(0.95, 0.25, uv.y);
    col += vec3(1.0, 0.86, 0.58) * shaft * sunVisible * uWeather[26] * 0.18;

    return col;
}

vec3 applyDebugWireframe(vec3 col, vec2 uv) {
    if (!uWireframe) return col;
    vec2 grid = abs(fract(uv * vec2(16.0, 9.0)) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.018, min(grid.x, grid.y));
    float centerX = 1.0 - smoothstep(0.0, 0.006, abs(uv.x - 0.5));
    float centerY = 1.0 - smoothstep(0.0, 0.006, abs(uv.y - 0.5));
    return mix(col, vec3(0.0, 1.0, 0.75), max(line * 0.65, max(centerX, centerY) * 0.8));
}

void main() {
    float zoom = max(uView.x, 0.001);
    vec2 uv = (vUv - 0.5) / zoom + 0.5;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    vec3 raw = texture(uScene, uv).rgb;
    if (uWeather[32] < 0.5 || uEffectIsolation == 1) {
        fragColor = vec4(applyDebugWireframe(raw, vUv), 1.0);
        return;
    }

    vec3 color = raw;
    if (uEffectIsolation == 2) {
        color = applyColorGrade(color);
    } else if (uEffectIsolation == 3) {
        color = applyWeather(color, vUv);
    } else if (uEffectIsolation == 4) {
        color = applyFogAndLighting(color, vUv);
    } else if (uEffectIsolation == 5) {
        color = applyNight(color, vUv);
    } else if (uEffectIsolation == 6) {
        color = applyFogAndLighting(applyNight(color, vUv), vUv);
    } else {
        color = applyColorGrade(color);
        color = applyNight(color, vUv);
        color = applyWeather(color, vUv);
        color = applyFogAndLighting(color, vUv);
    }

    color = color / (color + vec3(1.0));
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    fragColor = vec4(applyDebugWireframe(color, vUv), 1.0);
}
`;

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
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
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

export class WebGLFallbackRenderer implements StreetViewRenderer {
    public readonly canvas: HTMLCanvasElement;
    public readonly backendType = 'webgl' as const;
    public readonly fallbackReason?: string;

    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private texture: WebGLTexture | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private weatherParams = new Float32Array(40);
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
        this.weatherParams[10] = 1.0;
        this.weatherParams[14] = 0.5;
        this.weatherParams[15] = 0.5;
        this.weatherParams[32] = 1.0;
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
            console.warn('[WebGLFallbackRenderer] init failed:', error instanceof Error ? error.message : String(error));
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
            this.weatherParams[32] = effectsData[8] || this.weatherParams[32];
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        this.weatherParams[32] = enabled ? 1.0 : 0.0;
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.cameraParams;
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public updateWeatherParams(params: Float32Array): void {
        this.weatherParams.set(params.subarray(0, Math.min(40, params.length)));
        this.shaderEffectsEnabled = this.weatherParams[32] >= 0.5;
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.weatherParams[33] = heading;
        this.weatherParams[34] = pitch;
        this.cameraParams = { heading, pitch };
    }

    public updateColorParams(params: Float32Array): void {
        this.weatherParams.set(params.subarray(0, Math.min(6, params.length)), 0);
    }

    public updateWeatherAnimation(): void {
        this.weatherParams[6] = ((Date.now() - this.startTime) / 1000) % 10000.0;
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

    public beginHoldTransition(_heading?: number, _pitch?: number): void {
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
