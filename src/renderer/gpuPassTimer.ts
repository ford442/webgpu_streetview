import { setGpuPassTimings, publishGpuPassTimingsToWindow } from './gpuPassTimingStore';

const QUERY_COUNT = 6;
const NS_TO_MS = 1 / 1_000_000;

/**
 * How this boot stamps the timestamp query set.
 *
 * - `'pass-descriptor'` — `timestampWrites` on `beginRenderPass` /
 *   `beginComputePass`. The spec path, and what every browser that ships
 *   `timestamp-query` today takes: Chrome/Edge 121+, Firefox Nightly, Safari
 *   TP. Needs `timestamp-query` only.
 * - `'inside-passes'` — the legacy pass-encoder `writeTimestamp`, kept for an
 *   implementation that rejects `timestampWrites` on the descriptor. Needs
 *   `timestamp-query-inside-passes`, and is only reachable when the descriptor
 *   probe below throws.
 * - `'none'` — no timestamps (SwiftShader, CI smoke, `?no_timestamps`). Every
 *   entry point is a no-op and the overlay reads `available: false`.
 */
export type TimestampWriteStrategy = 'pass-descriptor' | 'inside-passes' | 'none';

type TimestampWritable = {
    writeTimestamp(querySet: GPUQuerySet, queryIndex: number): void;
};

const TIMESTAMP_QUERY = 'timestamp-query' as GPUFeatureName;
const TIMESTAMP_QUERY_INSIDE_PASSES = 'timestamp-query-inside-passes' as GPUFeatureName;

/**
 * Probe whether this device accepts `timestampWrites` on a pass descriptor.
 *
 * The encoder is deliberately dropped instead of finished — an unsubmitted
 * command encoder costs nothing, and this keeps the probe out of the frame.
 */
function supportsPassDescriptorTimestampWrites(device: GPUDevice, querySet: GPUQuerySet): boolean {
    try {
        const encoder = device.createCommandEncoder({ label: 'streetview-timestamp-probe' });
        const pass = encoder.beginComputePass({
            timestampWrites: {
                querySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1,
            },
        });
        pass.end();
        return true;
    } catch {
        return false;
    }
}

/**
 * Pick the stamping path for this device. `timestamp-query` gates everything;
 * `timestamp-query-inside-passes` is consulted only as the fallback.
 */
export function resolveTimestampWriteStrategy(device: GPUDevice): TimestampWriteStrategy {
    if (!device.features?.has(TIMESTAMP_QUERY)) return 'none';
    return 'pass-descriptor';
}

/**
 * WebGPU timestamp-query helper for Pass1 (panorama), weather (fragment or compute), and blit.
 *
 * Spans are declared on the pass descriptor (`timestampWrites`) rather than
 * stamped with the deprecated encoder/pass `writeTimestamp`. Callers ask for a
 * `timestampWrites` object when they build the descriptor and additionally call
 * `markPassStart`/`markPassEnd`, which are no-ops unless the legacy
 * inside-passes fallback is active.
 *
 * No-ops gracefully when the feature is unavailable (SwiftShader / CI smoke).
 */
export class GpuPassTimer {
    private readonly querySet: GPUQuerySet;
    private readonly resolveBuffer: GPUBuffer;
    private readonly readBuffer: GPUBuffer;
    private pendingRead = false;
    /** Which stamping path this device took — mirrored onto the capability matrix. */
    public readonly strategy: TimestampWriteStrategy;

    constructor(private readonly device: GPUDevice) {
        this.querySet = device.createQuerySet({ type: 'timestamp', count: QUERY_COUNT });
        this.resolveBuffer = device.createBuffer({
            size: QUERY_COUNT * 8,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        this.readBuffer = device.createBuffer({
            size: QUERY_COUNT * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        let strategy = resolveTimestampWriteStrategy(device);
        if (strategy === 'pass-descriptor'
            && !supportsPassDescriptorTimestampWrites(device, this.querySet)) {
            strategy = device.features?.has(TIMESTAMP_QUERY_INSIDE_PASSES)
                ? 'inside-passes'
                : 'none';
            console.warn(
                '[GpuPassTimer] timestampWrites rejected on the pass descriptor; '
                + `falling back to ${strategy}.`,
            );
        }
        this.strategy = strategy;

        setGpuPassTimings({ available: strategy !== 'none' });
        publishGpuPassTimingsToWindow();
    }

    /**
     * `timestampWrites` for a render pass spanning `startIndex`..`endIndex`,
     * or undefined when this device is not on the descriptor path (a dictionary
     * member set to undefined is the same as omitting it).
     *
     * Indices: 0-1 pass1, 2-3 weather, 4-5 blit (compute path only).
     */
    renderPassTimestampWrites(
        startIndex: number,
        endIndex: number,
    ): GPURenderPassTimestampWrites | undefined {
        return this.timestampWrites(startIndex, endIndex);
    }

    /** `timestampWrites` for a compute pass. Same slot map as the render form. */
    computePassTimestampWrites(
        startIndex: number,
        endIndex: number,
    ): GPUComputePassTimestampWrites | undefined {
        return this.timestampWrites(startIndex, endIndex);
    }

    private timestampWrites(
        startIndex: number,
        endIndex: number,
    ): GPURenderPassTimestampWrites | undefined {
        if (this.strategy !== 'pass-descriptor') return undefined;
        return {
            querySet: this.querySet,
            beginningOfPassWriteIndex: startIndex,
            endOfPassWriteIndex: endIndex,
        };
    }

    /**
     * Legacy in-pass stamp. No-op on the descriptor path — the descriptor has
     * already declared both ends of the span.
     */
    markPassStart(pass: GPURenderPassEncoder | GPUComputePassEncoder, index: number): void {
        this.writeTimestampInsidePass(pass, index);
    }

    markPassEnd(pass: GPURenderPassEncoder | GPUComputePassEncoder, index: number): void {
        this.writeTimestampInsidePass(pass, index);
    }

    private writeTimestampInsidePass(
        pass: GPURenderPassEncoder | GPUComputePassEncoder,
        index: number,
    ): void {
        if (this.strategy !== 'inside-passes') return;
        const writable = pass as (GPURenderPassEncoder | GPUComputePassEncoder) & Partial<TimestampWritable>;
        if (typeof writable.writeTimestamp !== 'function') return;
        writable.writeTimestamp(this.querySet, index);
    }

    resolveAndScheduleRead(encoder: GPUCommandEncoder): void {
        if (this.strategy === 'none') return;
        if (this.pendingRead) return;
        encoder.resolveQuerySet(this.querySet, 0, QUERY_COUNT, this.resolveBuffer, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, QUERY_COUNT * 8);
        this.pendingRead = true;
        const readBuffer = this.readBuffer;
        this.device.queue.onSubmittedWorkDone().then(() => {
            this.pendingRead = false;
            void this.readTimings(readBuffer);
        }).catch(() => {
            this.pendingRead = false;
        });
    }

    private async readTimings(buffer: GPUBuffer): Promise<void> {
        try {
            await buffer.mapAsync(GPUMapMode.READ);
            const data = new BigUint64Array(buffer.getMappedRange());
            const delta = (a: number, b: number): number | null => {
                if (data[b]! <= data[a]!) return null;
                return Number(data[b]! - data[a]!) * NS_TO_MS;
            };
            setGpuPassTimings({
                pass1Ms: delta(0, 1),
                weatherMs: delta(2, 3),
                blitMs: delta(4, 5),
                available: true,
            });
            publishGpuPassTimingsToWindow();
            buffer.unmap();
        } catch {
            // Timestamp readback can fail on device loss or unsupported queues.
        }
    }

    destroy(): void {
        this.querySet.destroy();
        this.resolveBuffer.destroy();
        this.readBuffer.destroy();
        setGpuPassTimings({ available: false, pass1Ms: null, weatherMs: null, blitMs: null });
        publishGpuPassTimingsToWindow();
    }
}
