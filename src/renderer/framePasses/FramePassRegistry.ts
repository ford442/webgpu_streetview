import {
    isPassFailed,
    reportPassFailed,
    reportPassReady,
    type FramePassId,
} from '../passStatus';
import type { TextureLifecycle } from '../textureLifecycle';
import type { FramePassTimings } from '../frameLoop';

/** What every pass may read while it encodes one frame. Built once per frame by `Renderer`. */
export interface FrameContext {
    textures: TextureLifecycle;
    timings: FramePassTimings;
    /** This frame's swap-chain view, for passes that load what weather stored. */
    getSwapChainView: () => GPUTextureView | null;
}

/**
 * One stage of the frame, on the shared device and the frame's one encoder.
 *
 * A pass is a file plus a `registry.register(...)`: it owns its pipeline (built
 * in `init` through `gpuPipelineFactory`, so a WGSL error rejects instead of
 * yielding an invalid pipeline) and, if it needs per-frame data the 40-float
 * weather block does not carry, its *own* small uniform buffer — never new
 * weather slots.
 */
export interface FramePass {
    readonly id: FramePassId;
    /** Encode order, ascending. Gaps are deliberate: new passes slot between. */
    readonly order: number;
    /**
     * A required pass that fails `init` fails the boot (stage `pipeline`).
     * Anything else is disabled, reported on `webgpuProbe.passes`, and skipped.
     */
    readonly required?: boolean;
    /** Not initialised by `initAll` — the owner calls `initPass` when it is needed. */
    readonly lazy?: boolean;
    init(): Promise<void>;
    /** Whether this frame needs the pass at all (cheap; called every frame). */
    enabled(frame: FrameContext): boolean;
    encode(encoder: GPUCommandEncoder, frame: FrameContext): void;
    destroy(): void;
}

export class RequiredPassError extends Error {
    constructor(public readonly passId: FramePassId, reason: string) {
        super(`${passId} pass failed: ${reason}`);
        this.name = 'RequiredPassError';
    }
}

/**
 * The frame as an ordered list of passes: `streetview → [historical-wipe] →
 * weather | present-fallback → cabin-composite`.
 *
 * Boot builds every non-lazy pass concurrently (their WGSL fetches and pipeline
 * compiles overlap). Per frame, only passes that are ready *and* enabled are
 * encoded, so a pass that failed validation can never put an invalid pipeline
 * into the command buffer and take the road frame down with it.
 */
export class FramePassRegistry {
    private readonly passes: FramePass[] = [];
    private readonly ready = new Set<FramePassId>();
    /** Ids whose per-frame encode threw — warned once, not every frame. */
    private readonly warnedEncode = new Set<FramePassId>();

    public register(pass: FramePass): void {
        if (this.passes.some((p) => p.id === pass.id)) {
            throw new Error(`frame pass "${pass.id}" is already registered`);
        }
        this.passes.push(pass);
        this.passes.sort((a, b) => a.order - b.order);
    }

    public get(id: FramePassId): FramePass | undefined {
        return this.passes.find((p) => p.id === id);
    }

    public ids(): FramePassId[] {
        return this.passes.map((p) => p.id);
    }

    public isReady(id: FramePassId): boolean {
        return this.ready.has(id);
    }

    /**
     * Initialise every non-lazy pass concurrently and record each outcome.
     * Rejects with `RequiredPassError` (after every init has settled, so no
     * half-built pass is left running) when a required pass failed.
     */
    public async initAll(): Promise<void> {
        const eager = this.passes.filter((p) => !p.lazy);
        const outcomes = await Promise.allSettled(eager.map((p) => p.init()));
        let requiredFailure: RequiredPassError | null = null;
        outcomes.forEach((outcome, i) => {
            const pass = eager[i]!;
            if (outcome.status === 'fulfilled') {
                this.markReady(pass.id);
                return;
            }
            this.markFailed(pass.id, outcome.reason);
            if (pass.required && !requiredFailure) {
                requiredFailure = new RequiredPassError(pass.id, errorText(outcome.reason));
            }
        });
        if (requiredFailure) throw requiredFailure;
    }

    /** Initialise one pass (a lazy one, or a retry). Resolves to whether it is ready. */
    public async initPass(id: FramePassId): Promise<boolean> {
        const pass = this.get(id);
        if (!pass) return false;
        try {
            await pass.init();
            this.markReady(id);
            return true;
        } catch (error) {
            this.markFailed(id, error);
            return false;
        }
    }

    public markFailed(id: FramePassId, error: unknown): void {
        this.ready.delete(id);
        reportPassFailed(id, error);
    }

    private markReady(id: FramePassId): void {
        this.ready.add(id);
        reportPassReady(id);
    }

    /** Encode every ready, enabled pass in order. Returns the ids it encoded. */
    public encode(encoder: GPUCommandEncoder, frame: FrameContext): FramePassId[] {
        const encoded: FramePassId[] = [];
        for (const pass of this.passes) {
            if (!this.ready.has(pass.id) || isPassFailed(pass.id)) continue;
            if (!pass.enabled(frame)) continue;
            if (pass.required) {
                // The road frame itself: nothing to present without it, so let
                // the caller drop this frame rather than submit half of one.
                pass.encode(encoder, frame);
                encoded.push(pass.id);
                continue;
            }
            try {
                pass.encode(encoder, frame);
                encoded.push(pass.id);
            } catch (error) {
                if (!this.warnedEncode.has(pass.id)) {
                    this.warnedEncode.add(pass.id);
                    console.warn(`[frameLoop] ${pass.id} pass skipped this frame:`, error);
                }
            }
        }
        return encoded;
    }

    public destroyAll(): void {
        for (const pass of this.passes) {
            try {
                pass.destroy();
            } catch {
                // Teardown is best-effort; one pass must not strand the rest.
            }
        }
        this.ready.clear();
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
