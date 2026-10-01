import { vi } from 'vitest';
import { GpuPassTimer, resolveTimestampWriteStrategy } from './gpuPassTimer';
import { encodeStreetViewPass } from './streetViewPass';
import { recordBlitPass, recordWeatherPass } from './computeWeather/dispatch';
import { buildFramePassTimings } from './frameLoop';
import { createFakeGpu, installGpuGlobals, type FakeGpu } from './computeWeather/__tests__/fakeGpu';

const TIMESTAMP_QUERY = 'timestamp-query';
const INSIDE_PASSES = 'timestamp-query-inside-passes';

/** The fake device is enough for the timer: query set, buffers, encoders. */
function makeTimer(gpu: FakeGpu): GpuPassTimer {
  return new GpuPassTimer(gpu.device);
}

describe('GpuPassTimer strategy selection', () => {
  beforeEach(() => {
    installGpuGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is inert without timestamp-query', () => {
    const gpu = createFakeGpu();
    expect(resolveTimestampWriteStrategy(gpu.device)).toBe('none');

    const timer = makeTimer(gpu);
    expect(timer.strategy).toBe('none');
    expect(timer.renderPassTimestampWrites(0, 1)).toBeUndefined();
    expect(timer.computePassTimestampWrites(2, 3)).toBeUndefined();

    const encoder = gpu.createCommandEncoder();
    timer.resolveAndScheduleRead(encoder);
    expect(gpu.lastEncoder().querySetResolves).toEqual([]);
  });

  it('prefers pass-descriptor timestampWrites when timestamp-query is enabled', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY, INSIDE_PASSES] });
    const timer = makeTimer(gpu);

    expect(timer.strategy).toBe('pass-descriptor');
    expect(timer.renderPassTimestampWrites(0, 1)).toEqual({
      querySet: gpu.querySets[0],
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    });
  });

  it('falls back to inside-passes when the descriptor probe is rejected', () => {
    const gpu = createFakeGpu({
      features: [TIMESTAMP_QUERY, INSIDE_PASSES],
      rejectPassDescriptorTimestampWrites: true,
    });
    const timer = makeTimer(gpu);

    expect(timer.strategy).toBe('inside-passes');
    expect(timer.renderPassTimestampWrites(0, 1)).toBeUndefined();
  });

  it('degrades to none when the descriptor is rejected and inside-passes is absent', () => {
    const gpu = createFakeGpu({
      features: [TIMESTAMP_QUERY],
      rejectPassDescriptorTimestampWrites: true,
    });
    expect(makeTimer(gpu).strategy).toBe('none');
  });

  it('resolves the whole query set on the descriptor path', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    const encoder = gpu.createCommandEncoder();

    timer.resolveAndScheduleRead(encoder);

    expect(gpu.lastEncoder().querySetResolves).toEqual([
      { querySet: gpu.querySets[0], firstQuery: 0, queryCount: 6 },
    ]);
  });
});

describe('pass encoders declare timestampWrites instead of stamping inside the pass', () => {
  beforeEach(() => {
    installGpuGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts the pass-1 span on the render pass descriptor', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    const timings = buildFramePassTimings(timer, 'fragment');
    const encoder = gpu.createCommandEncoder();

    encodeStreetViewPass(
      encoder,
      { kind: 'view' } as unknown as GPUTextureView,
      { kind: 'pipeline' } as unknown as GPURenderPipeline,
      { kind: 'bindGroup' } as unknown as GPUBindGroup,
      timings.pass1,
    );

    const pass = gpu.lastEncoder().passes[0]!;
    expect(pass.timestampWrites).toEqual({
      querySet: gpu.querySets[0],
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    });
    expect(pass.writeTimestampCalls).toEqual([]);
    expect(pass.ended).toBe(true);
  });

  it('puts the weather and blit spans on the compute-path descriptors', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    const timings = buildFramePassTimings(timer, 'compute');
    const encoder = gpu.createCommandEncoder();

    recordWeatherPass(encoder, {
      pipeline: { kind: 'computePipeline' } as unknown as GPUComputePipeline,
      bindGroup: { kind: 'bindGroup' } as unknown as GPUBindGroup,
      lutBindGroup: null,
      width: 64,
      height: 64,
      timing: timings.weather,
    });
    recordBlitPass(encoder, {
      pipeline: { kind: 'renderPipeline' } as unknown as GPURenderPipeline,
      bindGroup: { kind: 'bindGroup' } as unknown as GPUBindGroup,
      targetView: { kind: 'view' } as unknown as GPUTextureView,
      timing: timings.weather,
    });

    const [weatherPass, blitPass] = gpu.lastEncoder().passes;
    expect(weatherPass!.type).toBe('compute');
    expect(weatherPass!.timestampWrites).toEqual({
      querySet: gpu.querySets[0],
      beginningOfPassWriteIndex: 2,
      endOfPassWriteIndex: 3,
    });
    expect(blitPass!.timestampWrites).toEqual({
      querySet: gpu.querySets[0],
      beginningOfPassWriteIndex: 4,
      endOfPassWriteIndex: 5,
    });
    expect(weatherPass!.writeTimestampCalls).toEqual([]);
    expect(blitPass!.writeTimestampCalls).toEqual([]);
  });

  it('leaves the fragment path without a blit span', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    const timings = buildFramePassTimings(timer, 'fragment');
    const encoder = gpu.createCommandEncoder();

    recordBlitPass(encoder, {
      pipeline: { kind: 'renderPipeline' } as unknown as GPURenderPipeline,
      bindGroup: { kind: 'bindGroup' } as unknown as GPUBindGroup,
      targetView: { kind: 'view' } as unknown as GPUTextureView,
      timing: timings.weather,
    });

    expect(gpu.lastEncoder().passes[0]!.timestampWrites).toBeUndefined();
  });

  it('stamps inside the pass only on the legacy fallback', () => {
    const gpu = createFakeGpu({
      features: [TIMESTAMP_QUERY, INSIDE_PASSES],
      rejectPassDescriptorTimestampWrites: true,
    });
    const timer = makeTimer(gpu);
    const timings = buildFramePassTimings(timer, 'fragment');
    const encoder = gpu.createCommandEncoder();

    encodeStreetViewPass(
      encoder,
      { kind: 'view' } as unknown as GPUTextureView,
      { kind: 'pipeline' } as unknown as GPURenderPipeline,
      { kind: 'bindGroup' } as unknown as GPUBindGroup,
      timings.pass1,
    );

    const pass = gpu.lastEncoder().passes[0]!;
    expect(pass.timestampWrites).toBeUndefined();
    expect(pass.writeTimestampCalls).toEqual([
      { querySet: gpu.querySets[0], index: 0 },
      { querySet: gpu.querySets[0], index: 1 },
    ]);
  });
});

describe('GpuPassTimer readback', () => {
  beforeEach(() => {
    installGpuGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Let queued promise callbacks (work-done → mapAsync → finally) run. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  function readBufferOf(gpu: FakeGpu) {
    return gpu.buffers.find((b) => b.descriptor.label === 'gpu-pass-timer-read')!;
  }

  /** One frame as frameLoop does it: encode, resolve, submit synchronously. */
  function frame(gpu: FakeGpu, timer: GpuPassTimer) {
    const encoder = gpu.createCommandEncoder();
    timer.resolveAndScheduleRead(encoder);
    gpu.device.queue.submit([encoder.finish()]);
    return gpu.lastEncoder();
  }

  it('labels its resolve and readback buffers', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    makeTimer(gpu);
    expect(gpu.buffers.map((b) => b.descriptor.label).sort()).toEqual([
      'gpu-pass-timer-read',
      'gpu-pass-timer-resolve',
    ]);
  });

  it('never copies into the readback buffer until the previous map has unmapped', async () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY], manualMaps: true });
    const timer = makeTimer(gpu);
    const readBuffer = readBufferOf(gpu);

    const a = frame(gpu, timer);
    expect(a.bufferCopies).toHaveLength(1);
    await flush();
    // Work done fired; the map is in flight.
    expect(readBuffer.mapState).toBe('pending');

    // The next frames must not touch the buffer while the map is pending…
    const b = frame(gpu, timer);
    expect(b.bufferCopies).toEqual([]);
    expect(b.querySetResolves).toEqual([]);

    // …or while it is mapped and being read.
    gpu.settleMaps();
    expect(readBuffer.mapState).toBe('mapped');
    const c = frame(gpu, timer);
    expect(c.bufferCopies).toEqual([]);

    await flush();
    expect(readBuffer.mapState).toBe('unmapped');

    const d = frame(gpu, timer);
    expect(d.bufferCopies).toHaveLength(1);
    expect(d.bufferCopies[0]!.dstMapState).toBe('unmapped');
    expect(gpu.submitErrors).toEqual([]);
  });

  it('clears the pending flag when onSubmittedWorkDone rejects', async () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    const queue = gpu.device.queue as { onSubmittedWorkDone: () => Promise<undefined> };
    queue.onSubmittedWorkDone = () => Promise.reject(new Error('device lost'));

    frame(gpu, timer);
    await flush();
    expect(frame(gpu, timer).bufferCopies).toHaveLength(1);
    expect(readBufferOf(gpu).mapState).toBe('unmapped');
  });

  it('clears the pending flag without unmapping when mapAsync rejects', async () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY], manualMaps: true });
    const timer = makeTimer(gpu);
    const readBuffer = readBufferOf(gpu);
    const unmap = vi.spyOn(readBuffer, 'unmap');

    frame(gpu, timer);
    await flush();
    gpu.settleMaps(false);
    await flush();

    expect(unmap).not.toHaveBeenCalled();
    expect(readBuffer.mapState).toBe('unmapped');
    expect(frame(gpu, timer).bufferCopies).toHaveLength(1);
    expect(gpu.submitErrors).toEqual([]);
  });

  it('stops scheduling reads once destroyed', () => {
    const gpu = createFakeGpu({ features: [TIMESTAMP_QUERY] });
    const timer = makeTimer(gpu);
    timer.destroy();
    expect(frame(gpu, timer).bufferCopies).toEqual([]);
  });
});
