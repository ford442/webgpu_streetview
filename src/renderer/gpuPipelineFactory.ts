/**
 * Validation-safe GPU object creation.
 *
 * `device.createRenderPipeline()` never throws for a WGSL or layout error — it
 * returns an *invalid* pipeline and reports the problem asynchronously through
 * `uncapturederror`. A `try/catch` around it is therefore dead code for exactly
 * the failures that matter, and the invalid object poisons every command buffer
 * it is encoded into (one bad pass drops the whole road frame).
 *
 * Everything here turns those asynchronous validation errors into ordinary
 * promise rejections the caller can act on:
 *
 * - shader modules are created inside a `validation` error scope and their
 *   `getCompilationInfo()` errors are logged as `label:line:col` and thrown;
 * - pipelines go through `create*PipelineAsync`, which rejects with a
 *   `GPUPipelineError`, falling back to the sync call inside an error scope;
 * - `withErrorScope` wraps any other creation (buffers, textures, bind groups).
 *
 * Every object must carry a `label` — it is what the error message, about:gpu
 * and RenderDoc name the failure by. `gpuObjectLabels.test.ts` enforces that
 * for every `createShaderModule` / `create*Pipeline` call in the renderer.
 *
 * Fakes without the async entry points or error scopes (jsdom unit tests) get
 * the plain sync calls, so behaviour there is unchanged.
 */

export interface ShaderDiagnostic {
    type: GPUCompilationMessageType;
    message: string;
    lineNum: number;
    linePos: number;
}

/** A creation that failed validation, with the module/pipeline label and WGSL diagnostics. */
export class GpuValidationError extends Error {
    public readonly label: string;
    public readonly diagnostics: ShaderDiagnostic[];

    constructor(label: string, message: string, diagnostics: ShaderDiagnostic[] = []) {
        super(`[${label}] ${message}`);
        this.name = 'GpuValidationError';
        this.label = label;
        this.diagnostics = diagnostics;
    }
}

export type LabeledShaderModuleDescriptor = GPUShaderModuleDescriptor & { label: string };
export type LabeledRenderPipelineDescriptor = GPURenderPipelineDescriptor & { label: string };
export type LabeledComputePipelineDescriptor = GPUComputePipelineDescriptor & { label: string };

type ScopedDevice = GPUDevice & Partial<Pick<GPUDevice, 'pushErrorScope' | 'popErrorScope'>>;

function supportsErrorScopes(device: GPUDevice): boolean {
    const d = device as ScopedDevice;
    return typeof d.pushErrorScope === 'function' && typeof d.popErrorScope === 'function';
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/**
 * Run `fn` inside an error scope and reject if the device reported an error in
 * it. `fn` is synchronous on purpose: the scope is pushed and popped with no
 * `await` in between, so concurrent callers can never interleave on the
 * device's one scope stack. It is always popped — also when `fn` throws.
 */
export async function withErrorScope<T>(
    device: GPUDevice,
    filter: GPUErrorFilter,
    label: string,
    fn: () => T,
): Promise<T> {
    if (!supportsErrorScopes(device)) return fn();
    device.pushErrorScope(filter);
    let result: T;
    try {
        result = fn();
    } catch (thrown) {
        await device.popErrorScope().catch(() => null);
        throw thrown;
    }
    const error = await device.popErrorScope();
    if (error) throw new GpuValidationError(label, error.message);
    return result;
}

/** `file:line:col message` per diagnostic, for the console. */
export function formatDiagnostics(label: string, diagnostics: readonly ShaderDiagnostic[]): string {
    return diagnostics
        .map((d) => `${label}:${d.lineNum}:${d.linePos} ${d.type}: ${d.message}`)
        .join('\n');
}

async function readDiagnostics(module: GPUShaderModule): Promise<ShaderDiagnostic[]> {
    const m = module as GPUShaderModule & Partial<Pick<GPUShaderModule, 'getCompilationInfo'>>;
    if (typeof m.getCompilationInfo !== 'function') return [];
    try {
        const info = await m.getCompilationInfo();
        return Array.from(info.messages, (msg) => ({
            type: msg.type,
            message: msg.message,
            lineNum: msg.lineNum,
            linePos: msg.linePos,
        }));
    } catch {
        return [];
    }
}

/**
 * Create a shader module and reject with its WGSL errors (line/col included)
 * instead of letting them surface later as an invalid pipeline.
 */
export async function createShaderModuleChecked(
    device: GPUDevice,
    descriptor: LabeledShaderModuleDescriptor,
): Promise<GPUShaderModule> {
    const scoped = supportsErrorScopes(device);
    // Push, create and pop with no `await` in between: error scopes are one
    // stack per device, and pass inits run concurrently — a scope left open
    // across an await would capture another pass's errors (and lose its own).
    if (scoped) device.pushErrorScope('validation');
    let module: GPUShaderModule;
    try {
        module = device.createShaderModule(descriptor);
    } catch (thrown) {
        if (scoped) await device.popErrorScope().catch(() => null);
        throw thrown;
    }
    const scopeErrorPromise = scoped ? device.popErrorScope() : Promise.resolve(null);
    // An invalid module still answers getCompilationInfo, and its line/col is
    // far more useful than the scope's one-line message.
    const [diagnostics, scopeError] = await Promise.all([readDiagnostics(module), scopeErrorPromise]);

    const errors = diagnostics.filter((d) => d.type === 'error');
    if (errors.length > 0) {
        console.error(`[gpu] WGSL compilation failed:\n${formatDiagnostics(descriptor.label, errors)}`);
        throw new GpuValidationError(descriptor.label, errors[0]!.message, diagnostics);
    }
    if (scopeError) throw new GpuValidationError(descriptor.label, scopeError.message, diagnostics);
    return module;
}

/**
 * Build a render pipeline, rejecting on validation failure. Prefers
 * `createRenderPipelineAsync` (which also keeps compilation off the main
 * thread); falls back to the sync call inside a validation scope.
 */
export async function createRenderPipelineChecked(
    device: GPUDevice,
    descriptor: LabeledRenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
    const d = device as GPUDevice & Partial<Pick<GPUDevice, 'createRenderPipelineAsync'>>;
    if (typeof d.createRenderPipelineAsync === 'function') {
        try {
            return await d.createRenderPipelineAsync(descriptor);
        } catch (e) {
            throw new GpuValidationError(descriptor.label, errorMessage(e));
        }
    }
    return withErrorScope(device, 'validation', descriptor.label, () => device.createRenderPipeline(descriptor));
}

/** Compute twin of `createRenderPipelineChecked`. */
export async function createComputePipelineChecked(
    device: GPUDevice,
    descriptor: LabeledComputePipelineDescriptor,
): Promise<GPUComputePipeline> {
    const d = device as GPUDevice & Partial<Pick<GPUDevice, 'createComputePipelineAsync'>>;
    if (typeof d.createComputePipelineAsync === 'function') {
        try {
            return await d.createComputePipelineAsync(descriptor);
        } catch (e) {
            throw new GpuValidationError(descriptor.label, errorMessage(e));
        }
    }
    return withErrorScope(device, 'validation', descriptor.label, () => device.createComputePipeline(descriptor));
}

/** Fetch a WGSL file, rejecting on a non-2xx response (a 404 page is not WGSL). */
export async function fetchShaderSource(url: string, name = url): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${name}: ${response.status} ${response.statusText}`);
    }
    return response.text();
}
