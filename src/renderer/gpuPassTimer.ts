import { setGpuPassTimings, publishGpuPassTimingsToWindow } from './gpuPassTimingStore';

const QUERY_COUNT = 6;
const NS_TO_MS = 1 / 1_000_000;

type TimestampWritable = {
    writeTimestamp(querySet: GPUQuerySet, queryIndex: number): void;
};

/**
 * WebGPU timestamp-query helper for Pass1 (panorama), weather (fragment or compute), and blit.
 * No-ops gracefully when the feature is unavailable (SwiftShader / CI smoke).
 */
export class GpuPassTimer {
    private readonly querySet: GPUQuerySet;
    private readonly resolveBuffer: GPUBuffer;
    private readonly readBuffer: GPUBuffer;
    private pendingRead = false;

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
        setGpuPassTimings({ available: true });
        publishGpuPassTimingsToWindow();
    }

    /** Indices: 0-1 pass1, 2-3 weather, 4-5 blit (compute path only uses blit pair). */
    beginPass(encoder: GPUCommandEncoder, startIndex: number): void {
        (encoder as GPUCommandEncoder & TimestampWritable).writeTimestamp(this.querySet, startIndex);
    }

    endPass(encoder: GPUCommandEncoder, endIndex: number): void {
        (encoder as GPUCommandEncoder & TimestampWritable).writeTimestamp(this.querySet, endIndex);
    }

    markPassStart(pass: GPURenderPassEncoder | GPUComputePassEncoder, index: number): void {
        (pass as (GPURenderPassEncoder | GPUComputePassEncoder) & TimestampWritable).writeTimestamp(this.querySet, index);
    }

    markPassEnd(pass: GPURenderPassEncoder | GPUComputePassEncoder, index: number): void {
        (pass as (GPURenderPassEncoder | GPUComputePassEncoder) & TimestampWritable).writeTimestamp(this.querySet, index);
    }

    resolveAndScheduleRead(encoder: GPUCommandEncoder): void {
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
