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
