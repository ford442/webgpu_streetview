export class TransitionManager {
    private device: GPUDevice;
    private sampler: GPUSampler;

    // === TRANSITION SYSTEM ===
    private transitionPipelines: Map<string, GPURenderPipeline> = new Map();
    private transitionBindGroupLayout?: GPUBindGroupLayout;
    private transitionUniformBuffer?: GPUBuffer;
    private prevTexture?: GPUTexture;
    private activeTransition: string | null = null;
    private transitionProgress: number = 0.0;

    public readonly transitionDefaults: Record<string, { duration: number; param1: number; param2: number }> = {
        'fade':           { duration: 350, param1: 0.0, param2: 0.0 },
        'zoom':           { duration: 450, param1: 2.4, param2: 0.0 },
        'zoom-blur':      { duration: 500, param1: 2.5, param2: 1.1 },
        'zoom-chromatic': { duration: 500, param1: 2.5, param2: 1.0 },
    };

    // === INLINE TRANSITION SYSTEM ===
    private previousFrameTexture?: GPUTexture;
    private inlineTransitionProgress: number = 0.0;
    private legacyTransitionsEnabled: boolean = false;

    constructor(device: GPUDevice, sampler: GPUSampler) {
        this.device = device;
        this.sampler = sampler;
    }

    public async init(enableLegacyTransitions: boolean = false): Promise<void> {
        this.legacyTransitionsEnabled = enableLegacyTransitions;
        if (!this.legacyTransitionsEnabled) {
            return;
        }

        const baseUrl = process.env.PUBLIC_URL || '/';

        this.transitionBindGroupLayout = this.device.createBindGroupLayout({
            label: 'Transition Bind Group Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT,
                  texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT,
                  texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT,
                  sampler: { type: 'filtering' as GPUSamplerBindingType } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT,
                  buffer: { type: 'uniform' as GPUBufferBindingType } },
            ],
        });

        this.transitionUniformBuffer = this.device.createBuffer({
            label: 'Transition Uniforms',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.transitionBindGroupLayout],
        });

        const names = ['fade', 'zoom', 'zoom-blur', 'zoom-chromatic'] as const;
        const pipelinePromises = names.map(async (name) => {
            const url = `${baseUrl}/shaders/transition-${name}.wgsl`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
            const code = await response.text();

            const shaderModule = this.device.createShaderModule({
                label: `Transition ${name}`,
                code,
            });

            const pipeline = this.device.createRenderPipeline({
                label: `Transition Pipeline ${name}`,
                layout: pipelineLayout,
                vertex:   { module: shaderModule, entryPoint: 'vs_main' },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{ format: 'rgba16float' as GPUTextureFormat }],
                },
                primitive: { topology: 'triangle-list' },
            });

            return { name, pipeline };
        });

        const results = await Promise.all(pipelinePromises);
        for (const { name, pipeline } of results) {
            this.transitionPipelines.set(name, pipeline);
        }

        console.log('[Renderer] Transition pipelines ready:', Array.from(this.transitionPipelines.keys()).join(', '));
    }

    public beginTransition(mode: string = 'zoom'): void {
        if (!this.legacyTransitionsEnabled) return;
        if (!this.device) return;
        if (!this.transitionPipelines.has(mode)) {
            console.warn(`[Renderer] Unknown transition mode "${mode}" — skipping`);
            return;
        }
        this.activeTransition = mode;
        this.transitionProgress = 0.0;
    }

    public capturePanorama(_movementHeading: number, videoTexture: GPUTexture): void {
        if (!this.legacyTransitionsEnabled) return;
        if (!this.device || !videoTexture) return;

        if (!this.prevTexture ||
            this.prevTexture.width  !== videoTexture.width ||
            this.prevTexture.height !== videoTexture.height) {
            if (this.prevTexture) this.prevTexture.destroy();
            this.prevTexture = this.device.createTexture({
                label: 'Previous Panorama Snapshot',
                size: { width: videoTexture.width, height: videoTexture.height },
                format: videoTexture.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
        }

        const encoder = this.device.createCommandEncoder({ label: 'Snapshot encoder' });
        encoder.copyTextureToTexture(
            { texture: videoTexture },
            { texture: this.prevTexture  },
            { width: videoTexture.width, height: videoTexture.height },
        );
        this.device.queue.submit([encoder.finish()]);
    }

    public updateTransitionProgress(progress: number): void {
        if (!this.legacyTransitionsEnabled) return;
        this.transitionProgress = Math.max(0.0, Math.min(1.0, progress));
        if (!this.transitionUniformBuffer || !this.device || !this.activeTransition) return;

        const defaults = this.transitionDefaults[this.activeTransition];
        const data = new Float32Array([
            this.transitionProgress,
            defaults?.param1 ?? 0.0,
            defaults?.param2 ?? 0.0,
            0.0,
        ]);
        this.device.queue.writeBuffer(this.transitionUniformBuffer, 0, data);
    }

    public endTransition(): void {
        if (!this.legacyTransitionsEnabled) return;
        this.activeTransition   = null;
        this.transitionProgress = 0.0;
    }

    public isInTransition(): boolean {
        if (!this.legacyTransitionsEnabled) return false;
        return this.activeTransition !== null;
    }

    public get hasPrevTexture(): boolean {
        return this.prevTexture !== undefined;
    }

    public getTransitionDuration(mode?: string): number {
        if (!this.legacyTransitionsEnabled) return 450;
        const key = mode ?? this.activeTransition ?? 'zoom';
        return this.transitionDefaults[key]?.duration ?? 450;
    }

    public captureCurrentFrame(videoTexture: GPUTexture): void {
        if (!this.device || !videoTexture) {
            console.warn('[Renderer] captureCurrentFrame: device or videoTexture not available');
            return;
        }

        if (!this.previousFrameTexture ||
            this.previousFrameTexture.width  !== videoTexture.width ||
            this.previousFrameTexture.height !== videoTexture.height) {
            if (this.previousFrameTexture) this.previousFrameTexture.destroy();
            this.previousFrameTexture = this.device.createTexture({
                label: 'Previous Frame Snapshot',
                size: { width: videoTexture.width, height: videoTexture.height },
                format: videoTexture.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
        }

        const encoder = this.device.createCommandEncoder({ label: 'Capture Current Frame' });
        encoder.copyTextureToTexture(
            { texture: videoTexture },
            { texture: this.previousFrameTexture },
            { width: videoTexture.width, height: videoTexture.height },
        );
        this.device.queue.submit([encoder.finish()]);

        this.inlineTransitionProgress = 0.0;
    }

    public setTransitionProgress(progress: number): void {
        this.inlineTransitionProgress = Math.max(0.0, Math.min(1.0, progress));
    }

    public get inlineProgress(): number {
        return this.inlineTransitionProgress;
    }

    public get previousFrame(): GPUTexture | undefined {
        return this.previousFrameTexture;
    }

    public recordLastPan(_panX: number, _panY: number): void {
    }

    public renderTransitionPass(
        commandEncoder: GPUCommandEncoder,
        intermediateTextureView: GPUTextureView,
        videoTexture: GPUTexture,
        _mainPipeline: GPURenderPipeline,
        _mainBindGroup: GPUBindGroup
    ): boolean {
        const transitionPipeline = this.activeTransition
            ? this.transitionPipelines.get(this.activeTransition)
            : undefined;

        if (transitionPipeline && this.prevTexture && videoTexture &&
            this.transitionBindGroupLayout && this.transitionUniformBuffer) {
            const mainPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: intermediateTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            const tBindGroup = this.device.createBindGroup({
                label: 'Transition Bind Group',
                layout: this.transitionBindGroupLayout,
                entries: [
                    { binding: 0, resource: this.prevTexture.createView() },
                    { binding: 1, resource: videoTexture.createView() },
                    { binding: 2, resource: this.sampler },
                    { binding: 3, resource: { buffer: this.transitionUniformBuffer } },
                ],
            });
            mainPass.setPipeline(transitionPipeline);
            mainPass.setBindGroup(0, tBindGroup);
            mainPass.draw(3);
            mainPass.end();
            return true;
        }
        return false;
    }

    public dispose(): void {
        try {
            if (this.prevTexture) this.prevTexture.destroy();
            if (this.previousFrameTexture) this.previousFrameTexture.destroy();
            if (this.transitionUniformBuffer) this.transitionUniformBuffer.destroy();
            this.transitionPipelines.clear();
        } catch (e) {
            // ignore cleanup errors
        }
        this.prevTexture = undefined;
        this.previousFrameTexture = undefined;
        this.transitionUniformBuffer = undefined;
        this.activeTransition = null;
        this.transitionPipelines.clear();
    }
}
