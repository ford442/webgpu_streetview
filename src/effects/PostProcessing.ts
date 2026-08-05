import * as THREE from 'three';

/**
 * Advanced post-processing pipeline for the Three.js car interior overlay.
 *
 * Uses custom ShaderMaterial passes chained via WebGLRenderTargets.
 * All effects preserve alpha transparency so the car overlay composites
 * correctly on top of the WebGPU Street View canvas.
 *
 * Effect chain order: Scene → Bloom → Vignette → ChromaticAberration → FilmGrain → Screen
 */

// ============================================================================
// GLSL Shaders
// ============================================================================

/** Fullscreen vertex shader — outputs a clip-space quad with UV coordinates. */
const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Extracts pixels above a luminance threshold (soft knee) for bloom. */
const BRIGHT_PASS_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float threshold;
varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = threshold * 0.1;
    float soft = luminance - threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contribution = max(soft, luminance - threshold) / max(luminance, 0.00001);
    gl_FragColor = vec4(color.rgb * contribution, color.a);
}
`;

/** 9-tap separable Gaussian blur driven by a direction uniform. */
const GAUSSIAN_BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 direction;
uniform vec2 resolution;
varying vec2 vUv;

void main() {
    vec2 texel = direction / resolution;
    vec4 sum = vec4(0.0);

    sum += texture2D(tDiffuse, vUv - 4.0 * texel) * 0.0162;
    sum += texture2D(tDiffuse, vUv - 3.0 * texel) * 0.0540;
    sum += texture2D(tDiffuse, vUv - 2.0 * texel) * 0.1210;
    sum += texture2D(tDiffuse, vUv - 1.0 * texel) * 0.1945;
    sum += texture2D(tDiffuse, vUv)                * 0.2286;
    sum += texture2D(tDiffuse, vUv + 1.0 * texel) * 0.1945;
    sum += texture2D(tDiffuse, vUv + 2.0 * texel) * 0.1210;
    sum += texture2D(tDiffuse, vUv + 3.0 * texel) * 0.0540;
    sum += texture2D(tDiffuse, vUv + 4.0 * texel) * 0.0162;

    gl_FragColor = sum;
}
`;

/** Additive bloom composite — uses the original scene alpha. */
const BLOOM_COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float strength;
varying vec2 vUv;

void main() {
    vec4 base  = texture2D(tDiffuse, vUv);
    vec4 bloom = texture2D(tBloom, vUv);
    gl_FragColor = vec4(base.rgb + bloom.rgb * strength, base.a);
}
`;

/** Radial vignette darkening from screen edges. */
const VIGNETTE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float strength;
uniform float offset;
varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    vec2 coord = (vUv - 0.5) * 2.0;
    float d = dot(coord, coord);
    float vig = smoothstep(offset + strength, offset, d);
    color.rgb *= vig;
    gl_FragColor = color;
}
`;

/** Radial chromatic aberration — RGB channels offset outward from centre. */
const CHROMATIC_ABERRATION_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float strength;
uniform vec2 resolution;
varying vec2 vUv;

void main() {
    vec2 dir  = vUv - 0.5;
    float dist = length(dir);
    vec2 off  = dir * dist * strength / max(resolution.x, resolution.y);

    float r = texture2D(tDiffuse, vUv + off).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - off).b;
    float a = texture2D(tDiffuse, vUv).a;

    gl_FragColor = vec4(r, g, b, a);
}
`;

/** Animated film grain noise. */
const FILM_GRAIN_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float intensity;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float noise = hash(vUv * 1000.0 + time * 137.0) * 2.0 - 1.0;
    color.rgb += vec3(noise) * intensity;
    gl_FragColor = color;
}
`;

/** Pass-through copy. */
const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;

void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

// ============================================================================
// Configuration
// ============================================================================

export interface PostProcessingConfig {
    bloomEnabled: boolean;
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    vignetteEnabled: boolean;
    vignetteStrength: number;
    vignetteOffset: number;
    filmGrainEnabled: boolean;
    filmGrainIntensity: number;
    chromaticAberrationEnabled: boolean;
    chromaticAberrationStrength: number;
    /**
     * Depth of field and motion blur ship in the WebGPU weather post pass, not
     * in this Three.js car-interior pipeline — see applyCameraFX in
     * public/shaders/weather-post.wgsl, gated by
     * src/renderer/cinematicCameraFx.ts (quality >= high + reduced motion off).
     *
     * These fields mirror VisualPreset so a preset can be spread into this
     * config without losing keys; the passes below ignore them. Wiring a
     * Three-side equivalent needs a depth texture on the scene render target,
     * which this pipeline does not currently allocate.
     */
    depthOfFieldEnabled: boolean;
    depthOfFieldFocalLength: number;
    depthOfFieldBokehScale: number;
    motionBlurEnabled: boolean;
    motionBlurStrength: number;
}

export const DEFAULT_POST_PROCESSING_CONFIG: PostProcessingConfig = {
    bloomEnabled: false,
    bloomStrength: 0.5,
    bloomRadius: 0.4,
    bloomThreshold: 0.85,
    vignetteEnabled: false,
    vignetteStrength: 0.8,
    vignetteOffset: 1.0,
    filmGrainEnabled: false,
    filmGrainIntensity: 0.05,
    chromaticAberrationEnabled: false,
    chromaticAberrationStrength: 2.0,
    depthOfFieldEnabled: false,
    depthOfFieldFocalLength: 0.5,
    depthOfFieldBokehScale: 2.0,
    motionBlurEnabled: false,
    motionBlurStrength: 0.5,
};

// ============================================================================
// Pipeline
// ============================================================================

type EffectId = 'bloom' | 'vignette' | 'chromatic' | 'grain';

/**
 * Post-processing pipeline that chains fullscreen shader passes through
 * WebGLRenderTargets.  Designed for the Three.js car interior overlay
 * rendered with {@link THREE.WebGLRenderer}.
 *
 * When no effects are enabled the scene is rendered directly to the
 * default framebuffer with zero overhead.
 */
export class PostProcessingPipeline {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private config: PostProcessingConfig;

    // Fullscreen rendering helpers
    private readonly fsCamera: THREE.OrthographicCamera;
    private readonly fsScene: THREE.Scene;
    private readonly fsQuad: THREE.Mesh;

    // Render targets — full resolution
    private sceneRT: THREE.WebGLRenderTarget;
    private pingRT: THREE.WebGLRenderTarget;
    private pongRT: THREE.WebGLRenderTarget;

    // Render targets — half resolution (bloom)
    private bloomBrightRT: THREE.WebGLRenderTarget;
    private bloomBlurRT1: THREE.WebGLRenderTarget;
    private bloomBlurRT2: THREE.WebGLRenderTarget;

    // Shader materials
    private readonly brightPassMaterial: THREE.ShaderMaterial;
    private readonly blurMaterial: THREE.ShaderMaterial;
    private readonly bloomCompositeMaterial: THREE.ShaderMaterial;
    private readonly vignetteMaterial: THREE.ShaderMaterial;
    private readonly chromaticAberrationMaterial: THREE.ShaderMaterial;
    private readonly filmGrainMaterial: THREE.ShaderMaterial;
    private readonly copyMaterial: THREE.ShaderMaterial;

    private width: number;
    private height: number;
    private elapsedTime: number = 0;

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.config = { ...DEFAULT_POST_PROCESSING_CONFIG };

        // Determine physical pixel dimensions
        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        this.width = Math.max(1, Math.floor(size.x * pr));
        this.height = Math.max(1, Math.floor(size.y * pr));

        // ---- Shader materials (created before the quad so the type is valid) ----

        const base: THREE.ShaderMaterialParameters = {
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
        };

        this.copyMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: { tDiffuse: { value: null } },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: COPY_FRAG,
        });

        this.brightPassMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                threshold: { value: this.config.bloomThreshold },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: BRIGHT_PASS_FRAG,
        });

        const halfW = Math.max(1, Math.floor(this.width / 2));
        const halfH = Math.max(1, Math.floor(this.height / 2));

        this.blurMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                direction: { value: new THREE.Vector2(1.0, 0.0) },
                resolution: { value: new THREE.Vector2(halfW, halfH) },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: GAUSSIAN_BLUR_FRAG,
        });

        this.bloomCompositeMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                tBloom: { value: null },
                strength: { value: this.config.bloomStrength },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: BLOOM_COMPOSITE_FRAG,
        });

        this.vignetteMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                strength: { value: this.config.vignetteStrength },
                offset: { value: this.config.vignetteOffset },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: VIGNETTE_FRAG,
        });

        this.chromaticAberrationMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                strength: { value: this.config.chromaticAberrationStrength },
                resolution: { value: new THREE.Vector2(this.width, this.height) },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: CHROMATIC_ABERRATION_FRAG,
        });

        this.filmGrainMaterial = new THREE.ShaderMaterial({
            ...base,
            uniforms: {
                tDiffuse: { value: null },
                intensity: { value: this.config.filmGrainIntensity },
                time: { value: 0 },
            },
            vertexShader: FULLSCREEN_VERT,
            fragmentShader: FILM_GRAIN_FRAG,
        });

        // ---- Fullscreen quad ----

        this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.fsScene = new THREE.Scene();
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.fsQuad = new THREE.Mesh(geometry, this.copyMaterial);
        this.fsQuad.frustumCulled = false;
        this.fsScene.add(this.fsQuad);

        // ---- Render targets ----

        this.sceneRT = this.createRT(this.width, this.height, true);
        this.pingRT = this.createRT(this.width, this.height, false);
        this.pongRT = this.createRT(this.width, this.height, false);
        this.bloomBrightRT = this.createRT(halfW, halfH, false);
        this.bloomBlurRT1 = this.createRT(halfW, halfH, false);
        this.bloomBlurRT2 = this.createRT(halfW, halfH, false);
    }

    // ---- Configuration ------------------------------------------------------

    setConfig(config: Partial<PostProcessingConfig>): void {
        Object.assign(this.config, config);
        this.syncUniforms();
    }

    getConfig(): PostProcessingConfig {
        return { ...this.config };
    }

    // ---- Individual effect toggles ------------------------------------------

    setBloom(enabled: boolean, strength?: number): void {
        this.config.bloomEnabled = enabled;
        if (strength !== undefined) this.config.bloomStrength = strength;
        this.syncUniforms();
    }

    setVignette(enabled: boolean, strength?: number): void {
        this.config.vignetteEnabled = enabled;
        if (strength !== undefined) this.config.vignetteStrength = strength;
        this.syncUniforms();
    }

    setFilmGrain(enabled: boolean, intensity?: number): void {
        this.config.filmGrainEnabled = enabled;
        if (intensity !== undefined) this.config.filmGrainIntensity = intensity;
        this.syncUniforms();
    }

    setChromaticAberration(enabled: boolean, strength?: number): void {
        this.config.chromaticAberrationEnabled = enabled;
        if (strength !== undefined) this.config.chromaticAberrationStrength = strength;
        this.syncUniforms();
    }

    // ---- Rendering ----------------------------------------------------------

    /**
     * Renders the scene through the active post-processing chain.
     * Call this once per frame instead of `renderer.render(scene, camera)`.
     */
    render(deltaTime: number): void {
        this.elapsedTime += deltaTime;

        // Build ordered list of active effects
        const active: EffectId[] = [];
        if (this.config.bloomEnabled) active.push('bloom');
        if (this.config.vignetteEnabled) active.push('vignette');
        if (this.config.chromaticAberrationEnabled) active.push('chromatic');
        if (this.config.filmGrainEnabled) active.push('grain');

        // Fast path — no effects, render directly
        if (active.length === 0) {
            this.renderer.setRenderTarget(null);
            this.renderer.render(this.scene, this.camera);
            return;
        }

        // Save renderer state we may alter
        const prevAutoClear = this.renderer.autoClear;
        const prevClearAlpha = this.renderer.getClearAlpha();

        // 1. Render the scene into an off-screen target (transparent BG)
        this.renderer.autoClear = true;
        this.renderer.setClearAlpha(0);
        this.renderer.setRenderTarget(this.sceneRT);
        this.renderer.render(this.scene, this.camera);

        // Disable auto-clear for fullscreen quad passes
        this.renderer.autoClear = false;

        // 2. Walk the effect chain
        let currentTexture: THREE.Texture = this.sceneRT.texture;
        let usePing = true;

        for (let i = 0; i < active.length; i++) {
            const isLast = i === active.length - 1;
            const target = isLast ? null : (usePing ? this.pingRT : this.pongRT);

            switch (active[i]) {
                case 'bloom':
                    this.applyBloom(currentTexture, target);
                    break;

                case 'vignette':
                    this.vignetteMaterial.uniforms.tDiffuse!.value = currentTexture;
                    this.renderFullscreen(this.vignetteMaterial, target);
                    break;

                case 'chromatic':
                    this.chromaticAberrationMaterial.uniforms.tDiffuse!.value = currentTexture;
                    this.renderFullscreen(this.chromaticAberrationMaterial, target);
                    break;

                case 'grain':
                    this.filmGrainMaterial.uniforms.tDiffuse!.value = currentTexture;
                    this.filmGrainMaterial.uniforms.time!.value = this.elapsedTime;
                    this.renderFullscreen(this.filmGrainMaterial, target);
                    break;
            }

            if (target) {
                currentTexture = target.texture;
                usePing = !usePing;
            }
        }

        // Restore renderer state
        this.renderer.autoClear = prevAutoClear;
        this.renderer.setClearAlpha(prevClearAlpha);
        this.renderer.setRenderTarget(null);
    }

    // ---- Resize -------------------------------------------------------------

    /**
     * Resizes all internal render targets.  Pass CSS-pixel dimensions;
     * the pixel ratio is read from the renderer automatically.
     */
    setSize(width: number, height: number): void {
        const pr = this.renderer.getPixelRatio();
        this.width = Math.max(1, Math.floor(width * pr));
        this.height = Math.max(1, Math.floor(height * pr));

        const halfW = Math.max(1, Math.floor(this.width / 2));
        const halfH = Math.max(1, Math.floor(this.height / 2));

        this.sceneRT.setSize(this.width, this.height);
        this.pingRT.setSize(this.width, this.height);
        this.pongRT.setSize(this.width, this.height);
        this.bloomBrightRT.setSize(halfW, halfH);
        this.bloomBlurRT1.setSize(halfW, halfH);
        this.bloomBlurRT2.setSize(halfW, halfH);

        this.blurMaterial.uniforms.resolution!.value.set(halfW, halfH);
        this.chromaticAberrationMaterial.uniforms.resolution!.value.set(this.width, this.height);
    }

    // ---- Cleanup ------------------------------------------------------------

    dispose(): void {
        // Render targets
        this.sceneRT.dispose();
        this.pingRT.dispose();
        this.pongRT.dispose();
        this.bloomBrightRT.dispose();
        this.bloomBlurRT1.dispose();
        this.bloomBlurRT2.dispose();

        // Shader materials
        this.brightPassMaterial.dispose();
        this.blurMaterial.dispose();
        this.bloomCompositeMaterial.dispose();
        this.vignetteMaterial.dispose();
        this.chromaticAberrationMaterial.dispose();
        this.filmGrainMaterial.dispose();
        this.copyMaterial.dispose();

        // Geometry
        this.fsQuad.geometry.dispose();
    }

    // ---- Private helpers ----------------------------------------------------

    /**
     * Creates a render target with RGBA half-float storage and linear
     * filtering — suitable for HDR post-processing with alpha.
     */
    private createRT(width: number, height: number, depth: boolean): THREE.WebGLRenderTarget {
        return new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: depth,
            stencilBuffer: false,
        });
    }

    /** Renders the fullscreen quad with the given material to `target`. */
    private renderFullscreen(
        material: THREE.ShaderMaterial,
        target: THREE.WebGLRenderTarget | null,
    ): void {
        this.fsQuad.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.fsScene, this.fsCamera);
    }

    /**
     * Bloom: bright-pass extraction → multi-pass Gaussian blur → additive
     * composite back onto the input.
     */
    private applyBloom(
        inputTexture: THREE.Texture,
        outputTarget: THREE.WebGLRenderTarget | null,
    ): void {
        const halfW = this.bloomBlurRT1.width;
        const halfH = this.bloomBlurRT1.height;

        // Bright-pass extraction
        this.brightPassMaterial.uniforms.tDiffuse!.value = inputTexture;
        this.brightPassMaterial.uniforms.threshold!.value = this.config.bloomThreshold;
        this.renderFullscreen(this.brightPassMaterial, this.bloomBrightRT);

        // Iterative separable Gaussian blur (radius controls iteration count)
        const iterations = Math.max(1, Math.min(5, Math.ceil(this.config.bloomRadius * 5)));
        this.blurMaterial.uniforms.resolution!.value.set(halfW, halfH);

        for (let i = 0; i < iterations; i++) {
            // Horizontal pass
            this.blurMaterial.uniforms.tDiffuse!.value =
                i === 0 ? this.bloomBrightRT.texture : this.bloomBlurRT2.texture;
            this.blurMaterial.uniforms.direction!.value.set(1.0, 0.0);
            this.renderFullscreen(this.blurMaterial, this.bloomBlurRT1);

            // Vertical pass
            this.blurMaterial.uniforms.tDiffuse!.value = this.bloomBlurRT1.texture;
            this.blurMaterial.uniforms.direction!.value.set(0.0, 1.0);
            this.renderFullscreen(this.blurMaterial, this.bloomBlurRT2);
        }

        // Additive composite (preserves original alpha)
        this.bloomCompositeMaterial.uniforms.tDiffuse!.value = inputTexture;
        this.bloomCompositeMaterial.uniforms.tBloom!.value = this.bloomBlurRT2.texture;
        this.bloomCompositeMaterial.uniforms.strength!.value = this.config.bloomStrength;
        this.renderFullscreen(this.bloomCompositeMaterial, outputTarget);
    }

    /** Pushes current config values into shader uniforms. */
    private syncUniforms(): void {
        this.brightPassMaterial.uniforms.threshold!.value = this.config.bloomThreshold;
        this.bloomCompositeMaterial.uniforms.strength!.value = this.config.bloomStrength;
        this.vignetteMaterial.uniforms.strength!.value = this.config.vignetteStrength;
        this.vignetteMaterial.uniforms.offset!.value = this.config.vignetteOffset;
        this.filmGrainMaterial.uniforms.intensity!.value = this.config.filmGrainIntensity;
        this.chromaticAberrationMaterial.uniforms.strength!.value =
            this.config.chromaticAberrationStrength;
    }
}
