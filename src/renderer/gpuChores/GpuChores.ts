/**
 * Panorama analysis chores. Adopts the Renderer GPUDevice — never requestDevice.
 *
 * Backend order: WebGPU compute → WASM → JS. Weather post ownership is untouched.
 */

import { loadWasmModule, type StreetViewWasmAPI } from '../../wasm';
import { isWebGpuProbeOk } from '../webgpuBootProbe';
import {
  CHORES_WORKGROUP_SIZE,
  downsample2d,
  HIST_BINS,
  histDownsampleSize,
  lumaHistogramBt709,
  meanLumaFromHistogram,
  PICKER_THUMB_HEIGHT,
  PICKER_THUMB_WIDTH,
  reduceLumaBt709,
  type LumaReduce,
} from './lumaMath';
import {
  resolveCpuChoresBackend,
  resolveGpuChoresEligibility,
  type GpuChoresBackend,
} from './gpuChoresPolicy';
import { setGpuChoresStats } from './gpuChoresStatsStore';

export interface ChoresSample {
  backend: GpuChoresBackend;
  meanLuma: number;
  minLuma: number;
  maxLuma: number;
  bins: Uint32Array;
  sampleMs: number;
}

const ZERO_BINS = new Uint32Array(HIST_BINS);

export class GpuChores {
  private device: GPUDevice | null;
  private histPipeline: GPUComputePipeline | null = null;
  private downPipeline: GPUComputePipeline | null = null;
  private histBindLayout: GPUBindGroupLayout | null = null;
  private downBindLayout: GPUBindGroupLayout | null = null;
  private binsBuffer: GPUBuffer | null = null;
  private binsReadback: GPUBuffer | null = null;
  private sizeBuffer: GPUBuffer | null = null;
  private gpuReady = false;
  private gpuFailed = false;
  private initPromise: Promise<void> | null = null;
  private inFlight = false;
  private wasm: StreetViewWasmAPI | null = null;
  private readonly killSwitch: boolean;
  private readonly probeOk: boolean;

  constructor(device: GPUDevice | null) {
    const eligibility = resolveGpuChoresEligibility();
    this.killSwitch = eligibility.killSwitch;
    this.probeOk = eligibility.probeOk && isWebGpuProbeOk();
    this.device = eligibility.gpuEligible && device ? device : null;
    setGpuChoresStats({
      killSwitch: this.killSwitch,
      backend: this.device ? 'webgpu' : resolveCpuChoresBackend(false),
    });
  }

  /** Shared renderer device, or null when GPU chores are ineligible. */
  public getDevice(): GPUDevice | null {
    return this.device;
  }

  public async ensureReady(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    try {
      this.wasm = await loadWasmModule();
    } catch {
      this.wasm = null;
    }

    if (!this.device || this.killSwitch || !this.probeOk) {
      this.device = null;
      setGpuChoresStats({
        killSwitch: this.killSwitch,
        backend: resolveCpuChoresBackend(this.wasm?.isWasm === true),
      });
      return;
    }

    try {
      const base = `${process.env.PUBLIC_URL || '/'}/shaders`;
      const [histCode, downCode] = await Promise.all([
        fetchShader(`${base}/gpu-chores-hist.wgsl`),
        fetchShader(`${base}/gpu-chores-downsample.wgsl`),
      ]);
      const histModule = this.device.createShaderModule({ label: 'gpu-chores-hist', code: histCode });
      const downModule = this.device.createShaderModule({ label: 'gpu-chores-down', code: downCode });

      this.histBindLayout = this.device.createBindGroupLayout({
        label: 'gpu-chores-hist',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
      this.downBindLayout = this.device.createBindGroupLayout({
        label: 'gpu-chores-down',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      });

      this.histPipeline = this.device.createComputePipeline({
        label: 'luma_histogram_bt709',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.histBindLayout] }),
        compute: { module: histModule, entryPoint: 'luma_histogram_bt709' },
      });
      this.downPipeline = this.device.createComputePipeline({
        label: 'downsample_2d',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.downBindLayout] }),
        compute: { module: downModule, entryPoint: 'downsample_2d' },
      });

      this.binsBuffer = this.device.createBuffer({
        label: 'gpu-chores-bins',
        size: HIST_BINS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      this.binsReadback = this.device.createBuffer({
        label: 'gpu-chores-bins-read',
        size: HIST_BINS * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.sizeBuffer = this.device.createBuffer({
        label: 'gpu-chores-size',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.gpuReady = true;
      setGpuChoresStats({ backend: 'webgpu', killSwitch: this.killSwitch });
    } catch (err) {
      console.warn('[gpu-chores] WebGPU init failed — WASM/JS fallback', err);
      this.gpuFailed = true;
      this.gpuReady = false;
      this.device = null;
      setGpuChoresStats({
        backend: resolveCpuChoresBackend(this.wasm?.isWasm === true),
        killSwitch: this.killSwitch,
      });
    }
  }

  public currentBackend(): GpuChoresBackend {
    if (this.gpuReady && this.device) return 'webgpu';
    return resolveCpuChoresBackend(this.wasm?.isWasm === true);
  }

  /**
   * Histogram + reduce on packed RGBA (WASM if compiled, else JS).
   * Full-res input is quarter-downsampled first (break-even vs CPU hist).
   */
  public analyzeRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): ChoresSample {
    const quarter = histDownsampleSize(width, height);
    const small = this.downsampleRgba(rgba, width, height, quarter.width, quarter.height);
    return this.analyzePreparedRgba(small, quarter.width, quarter.height);
  }

  /** Hist/reduce on an already-downsampled packed buffer (CPU gauge fallback). */
  public analyzePreparedRgba(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): ChoresSample {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let bins: Uint32Array;
    let reduced: LumaReduce;

    if (this.wasm?.isWasm) {
      bins = this.wasm.lumaHistogramBt709(rgba, width, height);
      reduced = this.wasm.reduceLumaBt709(rgba, width, height);
    } else {
      bins = lumaHistogramBt709(rgba, width, height);
      reduced = reduceLumaBt709(rgba, width, height);
    }

    const sampleMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    const sample: ChoresSample = {
      backend: resolveCpuChoresBackend(this.wasm?.isWasm === true),
      meanLuma: reduced.mean,
      minLuma: reduced.min,
      maxLuma: reduced.max,
      bins,
      sampleMs,
    };
    this.publish(sample);
    return sample;
  }

  public downsampleRgba(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    dstW: number = PICKER_THUMB_WIDTH,
    dstH: number = PICKER_THUMB_HEIGHT,
  ): Uint8Array {
    if (this.wasm?.isWasm) {
      return this.wasm.downsample2d(rgba, width, height, dstW, dstH);
    }
    return downsample2d(rgba, width, height, dstW, dstH);
  }

  /**
   * GPU hist on a panorama texture (1/4-res samples). Falls back to CPU if
   * pipelines are not ready, a readback is in flight, or the probe/kill switch
   * forbids GPU chores.
   */
  public async sampleTexture(texture: GPUTexture): Promise<ChoresSample | null> {
    await this.ensureReady();
    if (!this.gpuReady || !this.device || !this.histPipeline || !this.histBindLayout
      || !this.binsBuffer || !this.binsReadback || this.inFlight) {
      return null;
    }
    this.inFlight = true;
    const started = performance.now();
    try {
      this.device.queue.writeBuffer(this.binsBuffer, 0, ZERO_BINS);
      const view = texture.createView();
      const bindGroup = this.device.createBindGroup({
        layout: this.histBindLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: { buffer: this.binsBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder({ label: 'gpu-chores-hist' });
      const pass = encoder.beginComputePass({ label: 'luma_histogram_bt709' });
      pass.setPipeline(this.histPipeline);
      pass.setBindGroup(0, bindGroup);
      const wg = CHORES_WORKGROUP_SIZE;
      const samplesX = Math.max(1, Math.ceil(texture.width / 2 / wg));
      const samplesY = Math.max(1, Math.ceil(texture.height / 2 / wg));
      pass.dispatchWorkgroups(samplesX, samplesY);
      pass.end();
      encoder.copyBufferToBuffer(this.binsBuffer, 0, this.binsReadback, 0, HIST_BINS * 4);
      this.device.queue.submit([encoder.finish()]);

      await this.binsReadback.mapAsync(GPUMapMode.READ);
      const bins = new Uint32Array(this.binsReadback.getMappedRange().slice(0));
      this.binsReadback.unmap();

      const { min, max } = extremaFromBins(bins);
      const sample: ChoresSample = {
        backend: 'webgpu',
        meanLuma: meanLumaFromHistogram(bins),
        minLuma: min,
        maxLuma: max,
        bins,
        sampleMs: performance.now() - started,
      };
      this.publish(sample);
      return sample;
    } catch (err) {
      console.warn('[gpu-chores] GPU hist failed — CPU fallback next sample', err);
      this.gpuFailed = true;
      this.gpuReady = false;
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * GPU box-downsample of a panorama texture into packed RGBA8 (picker thumbs).
   * Returns null when GPU chores are unavailable — callers use `downsampleRgba`.
   */
  public async downsampleTexture(
    texture: GPUTexture,
    dstW: number = PICKER_THUMB_WIDTH,
    dstH: number = PICKER_THUMB_HEIGHT,
  ): Promise<Uint8Array | null> {
    await this.ensureReady();
    if (!this.gpuReady || !this.device || !this.downPipeline || !this.downBindLayout || !this.sizeBuffer) {
      return null;
    }
    const byteLen = dstW * dstH * 4;
    const bytesPerRow = Math.ceil((dstW * 4) / 256) * 256;
    const dstTex = this.device.createTexture({
      label: 'gpu-chores-thumb',
      size: [dstW, dstH],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const readBuf = this.device.createBuffer({
      size: bytesPerRow * dstH,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const sizes = new Uint32Array([texture.width, texture.height, dstW, dstH]);
      this.device.queue.writeBuffer(this.sizeBuffer, 0, sizes);
      const bindGroup = this.device.createBindGroup({
        layout: this.downBindLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: dstTex.createView() },
          { binding: 2, resource: { buffer: this.sizeBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder({ label: 'gpu-chores-down' });
      const pass = encoder.beginComputePass({ label: 'downsample_2d' });
      pass.setPipeline(this.downPipeline);
      pass.setBindGroup(0, bindGroup);
      const wg = CHORES_WORKGROUP_SIZE;
      pass.dispatchWorkgroups(Math.ceil(dstW / wg), Math.ceil(dstH / wg));
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: dstTex },
        { buffer: readBuf, bytesPerRow, rowsPerImage: dstH },
        { width: dstW, height: dstH },
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const packed = new Uint8Array(readBuf.getMappedRange());
      const tight = new Uint8Array(byteLen);
      const rowBytes = dstW * 4;
      for (let y = 0; y < dstH; y += 1) {
        tight.set(packed.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
      }
      readBuf.unmap();
      return tight;
    } catch (err) {
      console.warn('[gpu-chores] GPU downsample failed', err);
      return null;
    } finally {
      dstTex.destroy();
      readBuf.destroy();
    }
  }

  public destroy(): void {
    this.binsBuffer?.destroy();
    this.binsReadback?.destroy();
    this.sizeBuffer?.destroy();
    this.binsBuffer = null;
    this.binsReadback = null;
    this.sizeBuffer = null;
    this.histPipeline = null;
    this.downPipeline = null;
    this.gpuReady = false;
    this.device = null;
  }

  private publish(sample: ChoresSample): void {
    setGpuChoresStats({
      backend: sample.backend,
      killSwitch: this.killSwitch,
      meanLuma: sample.meanLuma,
      minLuma: sample.minLuma,
      maxLuma: sample.maxLuma,
      sampleMs: sample.sampleMs,
    });
  }
}

async function fetchShader(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.text();
}

function extremaFromBins(bins: Uint32Array): { min: number; max: number } {
  let minBin = 0;
  let maxBin = 0;
  let found = false;
  for (let i = 0; i < bins.length; i += 1) {
    if ((bins[i] ?? 0) === 0) continue;
    if (!found) {
      minBin = i;
      found = true;
    }
    maxBin = i;
  }
  if (!found) return { min: 0, max: 0 };
  return { min: minBin / 255, max: maxBin / 255 };
}

export { meanLumaFromHistogram, downsample2d, lumaHistogramBt709, reduceLumaBt709 };
export type { GpuChoresBackend };
