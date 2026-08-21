import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

describe('gpu-chores isolation (#216)', () => {
  it('does not hang chores on weather-post compute/fragment', () => {
    expect(read('src', 'renderer', 'ComputeWeatherPostProcessor.ts')).not.toMatch(/gpuChores|luma_histogram/);
    expect(read('src', 'renderer', 'WeatherPostProcessor.ts')).not.toMatch(/gpuChores|luma_histogram/);
    expect(read('public', 'shaders', 'weather-post-compute.wgsl')).not.toMatch(/luma_histogram|downsample_2d/);
    expect(read('public', 'shaders', 'weather-post.wgsl')).not.toMatch(/luma_histogram|downsample_2d/);
  });

  it('GpuChores never requests its own GPUDevice', () => {
    expect(read('src', 'renderer', 'gpuChores', 'GpuChores.ts')).not.toMatch(/requestDevice\s*\(/);
    expect(read('src', 'renderer', 'gpuChores', 'GpuChores.ts')).not.toMatch(/requestAdapter\s*\(/);
  });

  it('?no_gpu_compute does not select weather fragment/compute', () => {
    expect(read('src', 'renderer', 'createStreetViewRenderer.ts')).not.toMatch(/no_gpu_compute/);
    expect(read('src', 'renderer', 'gpuChores', 'gpuChoresPolicy.ts'))
      .toMatch(/weather fragment\/compute is unchanged/);
  });
});
