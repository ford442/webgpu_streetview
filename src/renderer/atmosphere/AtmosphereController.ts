/**
 * The atmosphere LUTs on the GPU (Hillaire 2020): four compute entry points of
 * `public/shaders/atmosphere.wgsl`, rebuilt **on change** — the medium
 * (visibility, albedo, altitude) rebuilds all four, the sun moving more than
 * 0.1° rebuilds sky view + aerial perspective — never every frame for a
 * still sun. A frame with nothing to rebuild encodes nothing.
 *
 * Its own chunk (`scripts/chunks.json`), imported by `AtmosphereLayer` the
 * first time the pass is switched on. Nothing reads the LUTs yet: the frame is
 * bit-exact with the pass on or off. Input is the sun and live conditions only
 * — never the Maps canvas — so the hold-pause guard does not apply.
 *
 * Owns: 4 pipelines, 4 LUT textures (rgba16float), one 128-byte uniform
 * buffer (`AtmosphereParams`), a linear-clamp sampler and the bind groups.
 */
import { PUBLIC_URL } from '../../config/publicUrl';
import { requireWasm } from '../../wasm';
import { createComputePipelineChecked, createShaderModuleChecked, fetchShaderSource } from '../gpuPipelineFactory';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import {
    ATMOSPHERE_AERIAL_MAX_KM,
    ATMOSPHERE_LUT_FORMAT,
    ATMOSPHERE_LUT_SIZES,
    ATMOSPHERE_MEDIUM_FLOAT_COUNT,
    ATMOSPHERE_UNIFORM_FLOAT_COUNT,
    ATMOSPHERE_WORKGROUP,
    AtmosphereBinding as B,
    AtmosphereUniformIndex as U,
} from './atmosphereLayout';
import {
    atmosphereRebuild,
    createAtmosphereOptions,
    type AtmosphereBuiltState,
    type AtmosphereOptions,
    type AtmosphereRebuild,
} from './atmosphereOptions';
import { setAtmosphereStats } from './atmosphereStatsStore';

const SHADER_PATH = 'shaders/atmosphere.wgsl';

type LutName = keyof typeof ATMOSPHERE_LUT_SIZES;

export interface AtmosphereLuts {
    transmittance: GPUTexture;
    multiscatter: GPUTexture;
    skyview: GPUTexture;
    aerial: GPUTexture;
}

export interface AtmosphereControllerDeps {
    device: GPUDevice;
    /** Called when init fails, so `Renderer` can mark the pass failed. */
    onFailed?: (error: unknown) => void;
}

function lutList(luts: AtmosphereLuts): GPUTexture[] {
    return [luts.transmittance, luts.multiscatter, luts.skyview, luts.aerial];
}

interface Stage {
    pipeline: GPUComputePipeline;
    bindGroup: GPUBindGroup;
    size: readonly number[];
}

/** The pass-facing part, adapted by `AtmosphereLayer` into a `FramePass`. */
export interface AtmospherePassHooks {
    init(): Promise<void>;
    enabled(): boolean;
    encode(encoder: GPUCommandEncoder): void;
}

export class AtmosphereController {
    public readonly pass: AtmospherePassHooks;
    private readonly options: AtmosphereOptions = createAtmosphereOptions();
    private readonly uniforms = new Float32Array(ATMOSPHERE_UNIFORM_FLOAT_COUNT);
    private luts: AtmosphereLuts | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private stages: { transmittance: Stage; multiscatter: Stage; skyview: Stage; aerial: Stage } | null = null;
    private built: AtmosphereBuiltState | null = null;
    private builds = { medium: 0, sun: 0 };
    private initialised = false;
    private disposed = false;

    constructor(private readonly deps: AtmosphereControllerDeps) {
        this.pass = {
            init: () => this.init(),
            enabled: () => this.pendingRebuild() !== 'none',
            encode: (encoder) => this.encode(encoder),
        };
    }

    public setOptions(options: Readonly<AtmosphereOptions>): void {
        Object.assign(this.options, options);
        if (!options.enabled && this.initialised) setAtmosphereStats({ state: 'off' });
        else if (options.enabled && this.initialised) setAtmosphereStats({ state: 'ready' });
    }

    public isInitialised(): boolean {
        return this.initialised;
    }

    /** The LUT textures (tests, the e2e parity read-back; slice 2's weather bind group). */
    public getLuts(): Readonly<AtmosphereLuts> | null {
        return this.luts;
    }

    /** Builds so far — e2e and unit tests assert "on change, not per frame". */
    public getBuildCounts(): Readonly<{ medium: number; sun: number }> {
        return this.builds;
    }

    private async init(): Promise<void> {
        if (this.initialised) return;
        setAtmosphereStats({ state: 'loading', reason: null });
        try {
            await this.build();
            this.initialised = true;
            setAtmosphereStats({ state: this.options.enabled ? 'ready' : 'off' });
        } catch (error) {
            setAtmosphereStats({ state: 'failed', reason: error instanceof Error ? error.message : String(error) });
            this.deps.onFailed?.(error);
            throw error;
        }
    }

    private async build(): Promise<void> {
        const { device } = this.deps;
        const code = await fetchShaderSource(`${PUBLIC_URL}/${SHADER_PATH}`, 'atmosphere.wgsl');
        const module = await createShaderModuleChecked(device, { label: 'atmosphere.wgsl', code });
        if (this.disposed) throw new Error('the atmosphere pass was disposed while it loaded');

        const lut = (name: LutName, dimension: GPUTextureDimension): GPUTexture => {
            const [w, h, d = 1] = ATMOSPHERE_LUT_SIZES[name] as readonly number[];
            return createTrackedTexture(device, {
                label: `atmosphere-${name}-lut`,
                size: { width: w!, height: h!, depthOrArrayLayers: d },
                dimension,
                format: ATMOSPHERE_LUT_FORMAT,
                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            }, `atmosphere-${name}-lut`);
        };
        const luts: AtmosphereLuts = {
            transmittance: lut('transmittance', '2d'),
            multiscatter: lut('multiscatter', '2d'),
            skyview: lut('skyview', '2d'),
            aerial: lut('aerial', '3d'),
        };
        const uniformBuffer = createTrackedBuffer(device, {
            label: 'atmosphere-params',
            size: ATMOSPHERE_UNIFORM_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'atmosphere-params');
        const sampler = device.createSampler({
            label: 'atmosphere-lut-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        });

        const C = GPUShaderStage.COMPUTE;
        const paramsEntry: GPUBindGroupLayoutEntry = { binding: B.params, visibility: C, buffer: { type: 'uniform' } };
        const samplerEntry: GPUBindGroupLayoutEntry = { binding: B.sampler, visibility: C, sampler: { type: 'filtering' } };
        const sampled = (binding: number): GPUBindGroupLayoutEntry => ({
            binding, visibility: C, texture: { sampleType: 'float', viewDimension: '2d' },
        });
        const storage = (binding: number, viewDimension: GPUTextureViewDimension): GPUBindGroupLayoutEntry => ({
            binding, visibility: C, storageTexture: { access: 'write-only', format: ATMOSPHERE_LUT_FORMAT, viewDimension },
        });

        const tView = luts.transmittance.createView({ label: 'atmosphere-transmittance-view' });
        const msView = luts.multiscatter.createView({ label: 'atmosphere-multiscatter-view' });
        const svView = luts.skyview.createView({ label: 'atmosphere-skyview-view' });
        const apView = luts.aerial.createView({ label: 'atmosphere-aerial-view', dimension: '3d' });

        const stage = async (
            name: LutName,
            entryPoint: string,
            layoutEntries: GPUBindGroupLayoutEntry[],
            resources: Record<number, GPUBindingResource>,
        ): Promise<Stage> => {
            const layout = device.createBindGroupLayout({ label: `atmosphere-${name}-bgl`, entries: layoutEntries });
            const pipeline = await createComputePipelineChecked(device, {
                label: `atmosphere-${name}-pipeline`,
                layout: device.createPipelineLayout({ label: `atmosphere-${name}-layout`, bindGroupLayouts: [layout] }),
                compute: { module, entryPoint },
            });
            const bindGroup = device.createBindGroup({
                label: `atmosphere-${name}-bind-group`,
                layout,
                entries: layoutEntries.map((e) => ({ binding: e.binding, resource: resources[e.binding]! })),
            });
            return { pipeline, bindGroup, size: ATMOSPHERE_LUT_SIZES[name] };
        };

        const shared: Record<number, GPUBindingResource> = {
            [B.params]: { buffer: uniformBuffer },
            [B.sampler]: sampler,
            [B.transmittance]: tView,
            [B.multiscatter]: msView,
            [B.transmittanceOut]: tView,
            [B.multiscatterOut]: msView,
            [B.skyviewOut]: svView,
            [B.aerialOut]: apView,
        };
        try {
            const [transmittance, multiscatter, skyview, aerial] = await Promise.all([
                stage('transmittance', 'transmittance_lut', [paramsEntry, storage(B.transmittanceOut, '2d')], shared),
                stage('multiscatter', 'multiscatter_lut',
                    [paramsEntry, samplerEntry, sampled(B.transmittance), storage(B.multiscatterOut, '2d')], shared),
                stage('skyview', 'skyview_lut',
                    [paramsEntry, samplerEntry, sampled(B.transmittance), sampled(B.multiscatter),
                        storage(B.skyviewOut, '2d')], shared),
                stage('aerial', 'aerial_lut',
                    [paramsEntry, samplerEntry, sampled(B.transmittance), sampled(B.multiscatter),
                        storage(B.aerialOut, '3d')], shared),
            ]);
            if (this.disposed) throw new Error('the atmosphere pass was disposed while it loaded');
            this.stages = { transmittance, multiscatter, skyview, aerial };
            this.luts = luts;
            this.uniformBuffer = uniformBuffer;
        } catch (error) {
            for (const t of lutList(luts)) destroyTracked(t);
            destroyTracked(uniformBuffer);
            throw error;
        }
    }

    private desired(): AtmosphereBuiltState {
        return {
            sunAltitude: this.options.sunAltitude,
            visibilityM: this.options.visibilityM,
            groundAlbedo: this.options.groundAlbedo,
            observerAltitudeM: this.options.observerAltitudeM,
        };
    }

    private pendingRebuild(): AtmosphereRebuild {
        if (!this.options.enabled || !this.stages || this.disposed) return 'none';
        return atmosphereRebuild(this.built, this.desired());
    }

    private encode(encoder: GPUCommandEncoder): void {
        const rebuild = this.pendingRebuild();
        if (rebuild === 'none' || !this.stages || !this.uniformBuffer) return;
        const next = this.desired();
        const wasm = requireWasm();
        if (rebuild === 'medium') {
            this.uniforms.set(wasm.atmoParams(next.visibilityM, next.groundAlbedo).subarray(0, ATMOSPHERE_MEDIUM_FLOAT_COUNT));
        }
        // The sun's elevation is clamped to the hemisphere: the LUT frame needs sin/cos only.
        const elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, next.sunAltitude));
        const sinE = Math.sin(elevation);
        this.uniforms[U.sinSunElevation] = sinE;
        this.uniforms[U.cosSunElevation] = Math.cos(elevation);
        this.uniforms[U.sunIlluminance] = 1;
        this.uniforms[U.observerAltitudeKm] = next.observerAltitudeM / 1000;
        this.uniforms[U.aerialMaxKm] = ATMOSPHERE_AERIAL_MAX_KM;
        this.deps.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);

        const pass = encoder.beginComputePass({ label: `atmosphere-${rebuild}-rebuild` });
        const order = rebuild === 'medium'
            ? [this.stages.transmittance, this.stages.multiscatter, this.stages.skyview, this.stages.aerial]
            : [this.stages.skyview, this.stages.aerial];
        for (const stage of order) {
            pass.setPipeline(stage.pipeline);
            pass.setBindGroup(0, stage.bindGroup);
            // The aerial volume is one invocation per (u, v) column, marching its slices.
            pass.dispatchWorkgroups(
                Math.ceil(stage.size[0]! / ATMOSPHERE_WORKGROUP),
                Math.ceil(stage.size[1]! / ATMOSPHERE_WORKGROUP),
                1,
            );
        }
        pass.end();

        this.built = next;
        this.builds = rebuild === 'medium'
            ? { ...this.builds, medium: this.builds.medium + 1 }
            : { ...this.builds, sun: this.builds.sun + 1 };
        setAtmosphereStats({
            state: 'ready',
            mediumBuilds: this.builds.medium,
            sunBuilds: this.builds.sun,
            sunElevationDeg: elevation * 180 / Math.PI,
            visibilityKm: this.uniforms[U.visibilityKm]!,
            turbidity: this.uniforms[U.turbidity]!,
            sunColor: wasm.atmoSunColor(this.uniforms, sinE, next.observerAltitudeM),
        });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.luts) for (const t of lutList(this.luts)) destroyTracked(t);
        destroyTracked(this.uniformBuffer);
        this.luts = null;
        this.uniformBuffer = null;
        this.stages = null;
        this.built = null;
        setAtmosphereStats({ state: 'off' });
    }
}
