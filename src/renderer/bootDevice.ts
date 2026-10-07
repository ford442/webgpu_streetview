import {
    configureCanvasContext,
    checkRequiredLimits,
    collectOptionalDeviceFeatures,
    logAdapterCapabilities,
    resolveAdapterRequestOptions,
    buildCapabilityMatrix,
    describeAdapterSelection,
    attachUncapturedErrorHandler,
    labelDevice,
    getCanvasOutputFlags,
    readDisplayOutputCapabilities,
    readNoClipDistancesFlag,
    resolveCanvasOutputPolicy,
    type CanvasOutputPolicy,
} from './deviceInit';
import { DEVICE_LABELS } from './deviceCapabilities';
import { resolveHdrIntermediateFormat } from './shaderFeatureVariants';
import { createComputePipelineChecked, createShaderModuleChecked } from './gpuPipelineFactory';
import {
    adapterInfoFromGpuAdapter,
    publishWebGpuProbe,
    type WebGpuProbeAdapterInfo,
    type WebGpuProbeStage,
} from './webgpuBootProbe';
import {
    type RendererInitOptions,
    type WeatherPostProcessMode,
    getRendererPreference,
} from './RendererBackend';

type CapabilityMatrix = ReturnType<typeof buildCapabilityMatrix>;

export interface BootDeviceOptions {
    canvas: HTMLCanvasElement;
    weatherPostProcessMode: WeatherPostProcessMode;
    initOptions?: RendererInitOptions;
    /**
     * Registered on `device.lost` before anything else can touch the device.
     * Never called for a device this function destroyed itself on a failure
     * path — that loss is not news, and forwarding it is what used to turn one
     * failed boot into a re-init loop.
     */
    onDeviceLost: (info: GPUDeviceLostInfo) => void;
}

export interface BootDeviceSuccess {
    ok: true;
    device: GPUDevice;
    context: GPUCanvasContext;
    /** Swap-chain format actually applied — the HDR path swaps it. */
    presentationFormat: GPUTextureFormat;
    canvasOutputPolicy: CanvasOutputPolicy;
    intermediateFormat: GPUTextureFormat;
    capabilityMatrix: CapabilityMatrix;
    timestampQueriesAvailable: boolean;
    /** Probe metadata the caller replays when it publishes the success probe. */
    probe: BootProbeContext;
}

export interface BootDeviceFailure {
    ok: false;
    reason: string;
}

export interface BootProbeContext {
    preference: ReturnType<typeof getRendererPreference>;
    webglPreferenceDeferred: boolean;
    adapter?: WebGpuProbeAdapterInfo;
    capabilityMatrix?: CapabilityMatrix;
}

export type BootDeviceResult = BootDeviceSuccess | BootDeviceFailure;

/**
 * Device + canvas-context boot policy for the Street View renderer.
 *
 * **This module owns the only `requestDevice()` call site in the app** — car
 * mode adopts the device through `Renderer.getSharedGpuDevice()` rather than
 * asking for its own. `deviceInit.test.ts` enforces that by walking the
 * renderer sources; do not add a second call here or anywhere else.
 *
 * Every failure path publishes its own `webgpuProbe` with the stage that
 * failed and returns `{ ok: false }`; the success probe is published by the
 * caller, because a boot that succeeds can still be followed by a pipeline or
 * weather-post failure.
 *
 * The canvas context is acquired *before* the device exists, and every failure
 * after the device exists destroys it here (without reporting that loss), so a
 * failed boot never leaks a `GPUDevice` and never re-enters through `onDeviceLost`.
 */
export async function bootDevice(options: BootDeviceOptions): Promise<BootDeviceResult> {
    const { canvas, weatherPostProcessMode, initOptions, onDeviceLost } = options;

    const preference = getRendererPreference();
    const webglPreferenceDeferred = preference === 'webgl';
    const probe: BootProbeContext = { preference, webglPreferenceDeferred };

    const fail = (stage: WebGpuProbeStage, reason: string): BootDeviceFailure => {
        publishWebGpuProbe({
            ok: false,
            stage,
            reason,
            preference,
            webglPreferenceDeferred,
            adapter: probe.adapter,
            capabilityMatrix: probe.capabilityMatrix,
        });
        return { ok: false, reason };
    };

    if (!navigator.gpu) {
        console.warn('WebGPU not supported. Hard-fail — no live GL weather.');
        return fail('navigator', 'WebGPU is not supported in this browser');
    }

    // Before the device: a canvas that cannot give a WebGPU context must not
    // cost an adapter + device round trip, let alone leak the device.
    const context = canvas.getContext('webgpu');
    if (!context) {
        console.warn('Could not get WebGPU context. Hard-fail — no live GL weather.');
        return fail('canvas', 'Could not acquire a WebGPU canvas context');
    }

    const adapterOptions = await resolveAdapterRequestOptions(initOptions);
    const adapter = await navigator.gpu.requestAdapter(adapterOptions);
    if (!adapter) {
        console.warn('No WebGPU adapter found. Hard-fail — no live GL weather.');
        return fail('adapter', 'No compatible WebGPU adapter found');
    }
    probe.adapter = adapterInfoFromGpuAdapter(adapter);

    const limitCheck = checkRequiredLimits(adapter, weatherPostProcessMode);
    if (!limitCheck.ok) {
        console.warn('[Renderer] WebGPU adapter limits are insufficient:', limitCheck.reason);
        return fail('limits', limitCheck.reason!);
    }
    if (!limitCheck.gpuChores.eligible) {
        console.info('[Renderer] gpu-chores stay on WASM/JS:', limitCheck.gpuChores.reason);
    }

    const requiredFeatures = collectOptionalDeviceFeatures(adapter, {
        featureLevel: describeAdapterSelection(adapterOptions).featureLevel,
        enableClipDistances: !readNoClipDistancesFlag(),
    });

    let device: GPUDevice;
    try {
        // The one and only requestDevice — see the module doc comment.
        device = await adapter.requestDevice({
            label: DEVICE_LABELS.device,
            requiredFeatures,
            requiredLimits: limitCheck.requiredLimits,
        });
    } catch (deviceError) {
        const reason = deviceError instanceof Error ? deviceError.message : String(deviceError);
        console.warn('[Renderer] requestDevice failed:', reason);
        return fail('device', reason);
    }
    labelDevice(device);

    let destroyedHere = false;
    device.lost.then((info) => {
        if (destroyedHere) return;
        onDeviceLost(info);
    });
    /** A failure after the device exists: tear it down here, silently. */
    const failWithDevice = (stage: WebGpuProbeStage, reason: string): BootDeviceFailure => {
        destroyedHere = true;
        try {
            context.unconfigure();
        } catch {
            // Never configured, or already gone.
        }
        device.destroy();
        return fail(stage, reason);
    };

    const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    let canvasOutputPolicy = resolveCanvasOutputPolicy({
        preferredFormat,
        flags: getCanvasOutputFlags(),
        ...readDisplayOutputCapabilities(),
    });
    let appliedCanvas: ReturnType<typeof configureCanvasContext>;
    try {
        appliedCanvas = configureCanvasContext(context, device, preferredFormat, canvasOutputPolicy);
    } catch (configureError) {
        // The SDR retry inside threw too — no swap chain at all.
        const reason = configureError instanceof Error ? configureError.message : String(configureError);
        console.warn('[Renderer] Canvas configure failed:', reason);
        return failWithDevice('canvas', reason);
    }
    // Resize re-configures; keep the policy in sync with what the browser accepted.
    canvasOutputPolicy = {
        hdr: appliedCanvas.toneMapping === 'extended',
        p3: appliedCanvas.colorSpace === 'display-p3',
    };

    const intermediateFormat = resolveHdrIntermediateFormat(requiredFeatures);

    const capabilityMatrix = buildCapabilityMatrix(
        weatherPostProcessMode,
        limitCheck.requiredLimits!,
        requiredFeatures,
        {
            ...describeAdapterSelection(adapterOptions),
            canvas: appliedCanvas,
            intermediateFormat,
            gpuChores: limitCheck.gpuChores,
        },
    );
    probe.capabilityMatrix = capabilityMatrix;
    logAdapterCapabilities(
        adapter,
        adapterOptions.powerPreference,
        weatherPostProcessMode,
        requiredFeatures,
        capabilityMatrix,
    );
    attachUncapturedErrorHandler(device, capabilityMatrix);

    // Boot-probe compute smoke: catch Edge/Chrome shader backend gaps before weather mounts.
    try {
        await runComputeBootProbe(device);
    } catch (computeError) {
        const reason = computeError instanceof Error ? computeError.message : String(computeError);
        console.warn('[Renderer] Compute boot probe failed:', reason);
        return failWithDevice('compute', reason);
    }

    return {
        ok: true,
        device,
        context,
        // The HDR path swaps the swap-chain format, so pipelines follow what was applied.
        presentationFormat: appliedCanvas.format,
        canvasOutputPolicy,
        intermediateFormat,
        capabilityMatrix,
        timestampQueriesAvailable: capabilityMatrix.timestampQueriesAvailable,
        probe,
    };
}

/** Publish the `ok: true` probe once the whole renderer has come up. */
export function publishBootSuccess(probe: BootProbeContext): void {
    publishWebGpuProbe({
        ok: true,
        stage: 'ok',
        reason: '',
        preference: probe.preference,
        webglPreferenceDeferred: probe.webglPreferenceDeferred,
        adapter: probe.adapter,
        capabilityMatrix: probe.capabilityMatrix,
    });
}

/** Publish a failure probe for something that broke after `bootDevice` returned. */
export function publishBootFailure(probe: BootProbeContext, stage: WebGpuProbeStage, reason: string): void {
    publishWebGpuProbe({
        ok: false,
        stage,
        reason,
        preference: probe.preference,
        webglPreferenceDeferred: probe.webglPreferenceDeferred,
        adapter: probe.adapter,
        capabilityMatrix: probe.capabilityMatrix,
    });
}

/**
 * Tiny @compute pipeline, built through the validating factory — catches
 * Edge/Chrome shader-backend gaps during boot. Before the factory this could
 * not fail: a sync `createComputePipeline` returns an invalid object instead of
 * throwing.
 */
async function runComputeBootProbe(device: GPUDevice): Promise<void> {
    const module = await createShaderModuleChecked(device, {
        label: 'streetview-boot-compute-probe',
        code: `@compute @workgroup_size(1) fn main() {}`,
    });
    await createComputePipelineChecked(device, {
        label: 'streetview-boot-compute-probe-pipeline',
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
    });
}
