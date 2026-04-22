import { RenderMode } from './types';

export class Renderer {
    public canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    
    // Main panorama pipeline
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture;
    private videoTexture?: GPUTexture;
    private videoTextureWidth: number = 0;
    private videoTextureHeight: number = 0;
    private uniformBuffer!: GPUBuffer;
    
    // Car mode effects
    private carModeActive: boolean = false;
    private effectsBuffer?: GPUBuffer;
    
    // === DUAL-PASS WEATHER SYSTEM ===
    // Intermediate HDR texture for post-processing
    private intermediateTexture!: GPUTexture;
    private intermediateTextureView!: GPUTextureView;
    private intermediateWidth: number = 0;
    private intermediateHeight: number = 0;
    
    // Weather post-process pipeline
    private weatherPipeline!: GPURenderPipeline;
    private weatherBindGroup!: GPUBindGroup;
    private weatherParamsBuffer!: GPUBuffer;
    private weatherSampler!: GPUSampler;
    
    // Weather state
    // WeatherParams struct in WGSL: 40 floats (160 bytes) — multiple of 4 for 16-byte alignment
    // [0-5]: vibrance, saturation, contrast, exposure, temperature, tint
    // [6-10]: time, rainIntensity, snowIntensity, wind, speed
    // [11-15]: nightIntensity, headlightsOn, highBeam, headlightHeading, headlightPitch
    // [16-17]: domeLightOn, domeLightIntensity
    // [18-21]: sunAzimuth, sunAltitude, moonAzimuth, moonAltitude
    // [22-31]: fogIntensity, fogDensity, fogHeight, fogColorIndex, lightShaftsIntensity, heatShimmerIntensity, lensFlareIntensity, chromaticAberration, dustIntensity, humidityHaze
    // [32]: shaderEffectsEnabled
    // [33]: cameraHeading (for world-space effects)
    // [34]: cameraPitch (for world-space effects)
    // [35]: padding
    // [36]: sunrise
    // [37-39]: padding
    private weatherParams: Float32Array = new Float32Array(40);

    // Previous frame snapshot for seamless transitions
    private prevTexture?: GPUTexture;  // rgba8unorm-srgb snapshot of departing frame
    private currentTransitionProgress: number = 0.0;

    // World-space look-around: last rendered panX/Y (tracked every frame)
    private lastPanX: number = 0.5;
    private lastPanY: number = 0.5;
    // Captured at snapshot time — sent to shader so it can compute the heading delta
    private capturePanX: number = 0.5;
    private capturePanY: number = 0.5;
    private movementHeadingNorm: number = 0.5; // normalized 0-1 direction to next node

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
    private isDestroyed: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(options?: { onLost?: (info: GPUDeviceLostInfo) => void }): Promise<boolean> {
        this.onLostCallback = options?.onLost;
        if (!navigator.gpu) {
            console.warn('WebGPU not supported. Using StreetView fallback.');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('No WebGPU adapter found. Fallback active.');
                return false;
            }

            // Request HDR float format support
            const requiredFeatures: GPUFeatureName[] = [];
            if (adapter.features.has('float32-filterable')) {
                requiredFeatures.push('float32-filterable');
            }

            this.device = await adapter.requestDevice({ requiredFeatures });

            // Handle device loss for recovery
            this.device.lost.then((info) => {
                console.warn('[Renderer] WebGPU device lost:', info.reason, info.message);
                this.dispose();
                this.onLostCallback?.(info);
            });
            
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.warn('Could not get WebGPU context. Fallback active.');
                return false;
            }

            this.context = context;
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            this.configureContext();

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            this.weatherSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
            });

            // Initialize with a 1x1 placeholder
            this.createTexture(1, 1);

            this.uniformBuffer = this.device.createBuffer({
                // 8 floats × 4 bytes: [time, zoom, panX, panY, transitionProgress, movementHeading, capturePanX, capturePanY]
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Effects buffer for car mode (3 vec4s = 48 bytes)
            this.effectsBuffer = this.device.createBuffer({
                size: 48,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Weather params buffer (40 floats = 160 bytes for 16-byte alignment)
            this.weatherParamsBuffer = this.device.createBuffer({
                size: 160, // 40 floats × 4 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Initialize default weather params (40 floats to match 160 byte buffer)
            this.weatherParams.set([
                0.0,  // [0] vibrance
                0.0,  // [1] saturation
                0.0,  // [2] contrast
                0.0,  // [3] exposure
                0.0,  // [4] temperature
                0.0,  // [5] tint
                0.0,  // [6] time
                0.0,  // [7] rainIntensity
                0.0,  // [8] snowIntensity
                0.0,  // [9] wind
                1.0,  // [10] speed
                0.0,  // [11] nightIntensity
                0.0,  // [12] headlightsOn
                0.0,  // [13] highBeam
                0.5,  // [14] headlightHeading (center)
                0.5,  // [15] headlightPitch (center)
                0.0,  // [16] domeLightOn
                0.0,  // [17] domeLightIntensity
                0.0,  // [18] sunAzimuth
                0.0,  // [19] sunAltitude
                0.0,  // [20] moonAzimuth
                0.0,  // [21] moonAltitude
                0.0,  // [22] fogIntensity
                0.0,  // [23] fogDensity
                0.0,  // [24] fogHeight
                0.0,  // [25] fogColorIndex
                0.0,  // [26] lightShaftsIntensity
                0.0,  // [27] heatShimmerIntensity
                0.0,  // [28] lensFlareIntensity
                0.0,  // [29] chromaticAberration
                0.0,  // [30] dustIntensity
                0.0,  // [31] humidityHaze
                1.0,  // [32] shaderEffectsEnabled (default ON)
                0.0,  // [33] cameraHeading
                0.0,  // [34] cameraPitch
                0.0,  // [35] padding
                0.0,  // [36] sunrise
                0.0,  // [37] padding
                0.0,  // [38] padding
                0.0   // [39] padding
            ]);

            await this.createPipeline();
            await this.createWeatherPipeline();

            // Transition system is now inline in streetview.wgsl

            return true;
        } catch (e) {
            console.warn('WebGPU init failed:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    // Ensure intermediate HDR texture exists and is correct size
    private ensureIntermediateTexture(width: number, height: number) {
        if (this.intermediateTexture && 
            this.intermediateWidth === width && 
            this.intermediateHeight === height) {
            return;
        }

        if (this.intermediateTexture) {
            this.intermediateTexture.destroy();
        }

        this.intermediateWidth = width;
        this.intermediateHeight = height;

        // Create HDR intermediate texture (rgba16float for HDR)
        this.intermediateTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        this.intermediateTextureView = this.intermediateTexture.createView();

        // Update weather bind group with new intermediate view
        this.updateWeatherBindGroup();
    }

    private createTexture(width: number, height: number) {
        if (this.texture) this.texture.destroy();

        this.texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    private createVideoTexture(width: number, height: number) {
        if (this.videoTexture && this.videoTextureWidth === width && this.videoTextureHeight === height) {
            return;
        }

        if (this.videoTexture) this.videoTexture.destroy();

        this.videoTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.videoTextureWidth = width;
        this.videoTextureHeight = height;
    }

    private updateBindGroup() {
        if (!this.pipeline || !this.texture || !this.sampler || !this.uniformBuffer) return;

        const textureView = (this.videoTexture ? this.videoTexture.createView() : this.texture.createView());
        const prevTextureView = (this.prevTexture ? this.prevTexture.createView() : this.texture.createView());

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: textureView },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
                { binding: 3, resource: prevTextureView },
            ],
        });
    }

    private updateWeatherBindGroup() {
        if (!this.weatherPipeline || !this.intermediateTextureView || !this.weatherSampler) return;

        this.weatherBindGroup = this.device.createBindGroup({
            layout: this.weatherPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.weatherParamsBuffer } },
                { binding: 1, resource: this.intermediateTextureView },
                { binding: 2, resource: this.weatherSampler },
            ],
        });
    }

    private async createPipeline(): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/streetview.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                throw new Error(`Failed to load streetview.wgsl: ${response.status} ${response.statusText}`);
            }
            shaderCode = await response.text();
        } catch (error) {
            console.error(`[Renderer] Failed to load streetview shader from ${shaderUrl}:`, error);
            throw error;
        }

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' as GPUSamplerBindingType },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' as GPUBufferBindingType },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        // Main pipeline outputs to HDR intermediate format
        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'rgba16float' as GPUTextureFormat }], // ← HDR intermediate
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.updateBindGroup();
    }

    private shaderEffectsEnabled: boolean = true;

    /**
     * Toggle shader effects on/off
     * When disabled, renders raw Street View without post-processing
     */
    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        // Update the uniform immediately
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[32] = enabled ? 1.0 : 0.0;
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    /**
     * Get current camera parameters (for debugging)
     */
    public getCameraParams(): { heading: number; pitch: number } {
        return {
            heading: this.weatherParams[33],
            pitch: this.weatherParams[34]
        };
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    private async createWeatherPipeline(): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/weather-post.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                throw new Error(`Failed to load weather-post.wgsl: ${response.status} ${response.statusText}`);
            }
            shaderCode = await response.text();
        } catch (error) {
            console.error(`[Renderer] Failed to load weather-post shader from ${shaderUrl}:`, error);
            throw error;
        }

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' as GPUBufferBindingType },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' as GPUSamplerBindingType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        // Weather pipeline outputs to final canvas format
        this.weatherPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat as GPUTextureFormat }],
            },
            primitive: { topology: 'triangle-list' }, // Triangle for full-screen quad
        });

        this.updateWeatherBindGroup();
    }

    private configureContext() {
        if (!this.context || !this.device) return;
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'opaque',
        });
    }

    public resize(width: number, height: number) {
        if (this.isDestroyed) return;
        // Canvas size is driven by React props; just reconfigure the context
        // so the swap chain matches the new canvas size.
        this.configureContext();
    }

    public destroy() {
        this.isDestroyed = true;
        this.dispose();
    }

    private dispose() {
        try {
            if (this.texture) this.texture.destroy();
            if (this.videoTexture) this.videoTexture.destroy();
            if (this.intermediateTexture) this.intermediateTexture.destroy();
            if (this.uniformBuffer) this.uniformBuffer.destroy();
            if (this.effectsBuffer) this.effectsBuffer.destroy();
            if (this.weatherParamsBuffer) this.weatherParamsBuffer.destroy();
            if (this.prevTexture) this.prevTexture.destroy();
            this.device?.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.texture = undefined as any;
        this.videoTexture = undefined as any;
        this.intermediateTexture = undefined as any;
        this.uniformBuffer = undefined as any;
        this.effectsBuffer = undefined as any;
        this.weatherParamsBuffer = undefined as any;
        this.prevTexture = undefined;
        this.pipeline = undefined as any;
        this.weatherPipeline = undefined as any;
        this.bindGroup = undefined as any;
        this.weatherBindGroup = undefined as any;
    }

    public setCarMode(active: boolean): void {
        this.carModeActive = active;
    }

    public updateEffects(effectsData: Float32Array): void {
        if (this.effectsBuffer && this.device) {
            // Ensure shaderEffectsEnabled is passed through
            const fullEffects = new Float32Array(12); // 3 vec4s
            fullEffects.set(effectsData);
            // Set shaderEffectsEnabled at index 8 (start of third vec4)
            if (fullEffects[8] === 0) {
                fullEffects[8] = this.shaderEffectsEnabled ? 1.0 : 0.0;
            }
            this.device.queue.writeBuffer(this.effectsBuffer, 0, fullEffects);
        }
    }

    /**
     * Update weather parameters for the HDR post-process pass
     * @param params - Float32Array of 40 weather params:
     *   [0-5]: vibrance, saturation, contrast, exposure, temperature, tint
     *   [6-10]: time, rainIntensity, snowIntensity, wind, speed
     *   [11-15]: nightIntensity, headlightsOn, highBeam, headlightHeading, headlightPitch
     *   [16-17]: domeLightOn, domeLightIntensity
     *   [18-21]: sunAzimuth, sunAltitude, moonAzimuth, moonAltitude
     *   [22-31]: fogIntensity, fogDensity, fogHeight, fogColorIndex, lightShafts, heatShimmer, lensFlare, chromaticAberration, dust, humidityHaze
     *   [32]: shaderEffectsEnabled
     *   [33-34]: cameraHeading, cameraPitch
     *   [35]: padding
     *   [36]: sunrise
     *   [37-39]: padding
     */
    public updateWeatherParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    /**
     * Update camera parameters for world-space weather effects
     * @param heading - Camera heading in normalized coordinates (0-1, where 0.5 = center/north)
     * @param pitch - Camera pitch in normalized coordinates (0-1, where 0.5 = center)
     */
    public updateCameraParams(heading: number, pitch: number): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[33] = heading; // cameraHeading
            this.weatherParams[34] = pitch;   // cameraPitch
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    /**
     * Update color grading parameters (backward compatible)
     * @param params - Float32Array of 6 floats: [vibrance, saturation, contrast, exposure, temperature, tint]
     */
    public updateColorParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            // Update only the first 6 values (color grading)
            this.weatherParams.set(params.slice(0, 6), 0);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    // =========================================================================
    // TRANSITION SYSTEM
    // =========================================================================

    /**
     * Snapshot the current videoTexture into prevTexture for world-space transitions.
     * Stores the movement heading and current pan state so the shader can simulate
     * looking around the old panorama during the transition.
     *
     * @param movementHeading - Normalized heading (0-1) towards the next panorama node.
     *   Computed as `((bestLink.heading % 360) + 360) % 360 / 360`.
     */
    public capturePanorama(movementHeading: number): void {
        if (!this.device || !this.videoTexture) return;

        this.movementHeadingNorm = Math.max(0.0, Math.min(1.0, movementHeading));
        // Store the pan state at capture time — used by the shader to compute look-around delta
        this.capturePanX = this.lastPanX;
        this.capturePanY = this.lastPanY;

        // Ensure prevTexture exists and matches videoTexture dimensions/format
        if (!this.prevTexture ||
            this.prevTexture.width  !== this.videoTexture.width ||
            this.prevTexture.height !== this.videoTexture.height) {
            if (this.prevTexture) this.prevTexture.destroy();
            this.prevTexture = this.device.createTexture({
                label: 'Previous Panorama Snapshot',
                size: { width: this.videoTexture.width, height: this.videoTexture.height },
                format: this.videoTexture.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.updateBindGroup();
        }

        // GPU → GPU copy: zero CPU cost, ordered by the WebGPU queue
        const encoder = this.device.createCommandEncoder({ label: 'Snapshot encoder' });
        encoder.copyTextureToTexture(
            { texture: this.videoTexture },
            { texture: this.prevTexture },
            { width: this.videoTexture.width, height: this.videoTexture.height },
        );
        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * @deprecated Use capturePanorama(movementHeading) for world-space look-around transitions.
     * Kept for backward compatibility; delegates with the last stored movement heading.
     */
    public captureCurrentFrame(): void {
        this.capturePanorama(this.movementHeadingNorm);
    }

    /**
     * Set the transition progress for the inline shader transition.
     * 0.0 = fully old frame, 1.0 = fully new frame.
     */
    public setTransitionProgress(progress: number): void {
        this.currentTransitionProgress = Math.max(0.0, Math.min(1.0, progress));
        if (!this.uniformBuffer || !this.device) return;
        // Write only the 5th float (offset 16 bytes)
        const data = new Float32Array([this.currentTransitionProgress]);
        this.device.queue.writeBuffer(this.uniformBuffer, 16, data);
    }

    /**
     * Update weather animation time without rendering a full frame.
     * Call this continuously to keep rain/snow/wipers animating even when
     * the panorama source is not available (during transitions/loading).
     */
    public updateWeatherAnimation(): void {
        if (this.isDestroyed || !this.device || !this.weatherParamsBuffer) return;
        
        try {
            // Update time in weather params for continuous animation
            const time = Date.now() / 1000;
            this.weatherParams[6] = time % 10000.0; // looped time
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        } catch (e) {
            // Ignore errors during weather-only updates
        }
    }

    /**
     * Render weather effects only (no panorama).
     * Used during loading to show continuous rain/snow animation.
     */
    public renderWeatherOnly(): void {
        if (this.isDestroyed || !this.device || !this.weatherPipeline) return;

        try {
            // Update time for animation
            const time = Date.now() / 1000;
            this.weatherParams[6] = time % 10000.0;
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);

            // Ensure intermediate texture exists
            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            this.ensureIntermediateTexture(canvasWidth, canvasHeight);

            const commandEncoder = this.device.createCommandEncoder();

            // Clear intermediate texture to black/transparent
            const clearPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.intermediateTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });
            clearPass.end();

            // Render weather post-process directly to canvas
            const finalTextureView = this.context.getCurrentTexture().createView();
            
            const postPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: finalTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            postPass.setPipeline(this.weatherPipeline);
            postPass.setBindGroup(0, this.weatherBindGroup);
            postPass.draw(3, 1, 0, 0);
            postPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress errors during weather-only rendering
        }
    }

    public renderStreetView(
        mode: RenderMode, 
        source: CanvasImageSource | null, 
        heading?: number, 
        pitch?: number, 
        zoom?: number
    ): void {
        if (this.isDestroyed || !this.device || !this.pipeline || !this.weatherPipeline) return;

        // If no source and no transition snapshot available, fall back to weather-only
        if (!source && !(this.currentTransitionProgress > 0.0 && this.prevTexture && this.videoTexture)) {
            this.renderWeatherOnly();
            return;
        }

        let srcWidth = 0;
        let srcHeight = 0;

        if (source) {
            if (source instanceof HTMLCanvasElement) {
                srcWidth = source.width;
                srcHeight = source.height;
            } else if (source instanceof HTMLVideoElement) {
                if (source.readyState >= 2) {
                    srcWidth = source.videoWidth;
                    srcHeight = source.videoHeight;
                }
            } else if (source instanceof ImageBitmap) {
                srcWidth = source.width;
                srcHeight = source.height;
            }

            if (srcWidth > 0 && srcHeight > 0) {
                const needsBindGroupUpdate = !this.videoTexture || 
                    this.videoTextureWidth !== srcWidth || 
                    this.videoTextureHeight !== srcHeight;

                this.createVideoTexture(srcWidth, srcHeight);

                if (needsBindGroupUpdate) {
                    this.updateBindGroup();
                }

                try {
                    this.device.queue.copyExternalImageToTexture(
                        { source: source },
                        { texture: this.videoTexture! },
                        [srcWidth, srcHeight]
                    );
                } catch (e) {
                    // Ignore transient copy errors
                }
            }
        }

        try {
            // Update time in weather params for animation
            const time = Date.now() / 1000;
            this.weatherParams[6] = time % 10000.0; // looped time
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);

            // Update panorama uniforms — all 8 slots written every frame
            const z = zoom || 1;
            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;
            this.lastPanX = panX;
            this.lastPanY = panY;
            const uniforms = new Float32Array([
                time, z, panX, panY,
                this.currentTransitionProgress,
                this.movementHeadingNorm,  // [5] normalized heading towards next node
                this.capturePanX,          // [6] panX at snapshot time (look-around delta)
                this.capturePanY,          // [7] panY at snapshot time
            ]);
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

            // Ensure intermediate texture is correct size
            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            this.ensureIntermediateTexture(canvasWidth, canvasHeight);

            const commandEncoder = this.device.createCommandEncoder();

            // === PASS 1: Panorama → Intermediate HDR texture ===
            // During a transition, swap in the dual-texture transition pipeline.
            const mainPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.intermediateTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            mainPass.setPipeline(this.pipeline);
            mainPass.setBindGroup(0, this.bindGroup);
            mainPass.draw(4, 1, 0, 0); // triangle strip

            mainPass.end();

            // === PASS 2: Intermediate + Weather → Canvas ===
            const finalTextureView = this.context.getCurrentTexture().createView();
            
            const postPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: finalTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            postPass.setPipeline(this.weatherPipeline);
            postPass.setBindGroup(0, this.weatherBindGroup);
            postPass.draw(3, 1, 0, 0); // Full-screen triangle
            postPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors
        }
    }
}
