import { createStreetViewRenderer } from './createStreetViewRenderer';
import { Renderer } from './Renderer';
import { vi, type Mock } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const mockRendererInit = vi.fn();
const mockRendererDestroy = vi.fn();
const mockCallOrder: Array<'webgpu'> = [];
let mockWebgpuFallbackReason: string | undefined;

vi.mock('./Renderer', () => ({ Renderer: vi.fn() }));

const MockedRenderer = Renderer as unknown as Mock;

describe('createStreetViewRenderer (WebGPU-required hard-fail)', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(() => {
    resetSearch();
    localStorage.clear();
    delete (window as any).rendererType;
    delete (window as any).streetViewRendererDebug;
    delete (window as any).webgpuProbe;
    delete (window as any).usingWebGL;
    delete (window as any).usingWebGPU;
    delete (window as any).rendererFallbackReason;
    mockCallOrder.length = 0;
    mockWebgpuFallbackReason = undefined;

    mockRendererInit.mockReset().mockResolvedValue(true);
    mockRendererDestroy.mockReset();

    MockedRenderer.mockReset().mockImplementation(function (this: any, canvas: HTMLCanvasElement) {
      mockCallOrder.push('webgpu');
      this.canvas = canvas;
      this.backendType = 'webgpu';
      this.fallbackReason = mockWebgpuFallbackReason;
      this.init = mockRendererInit;
      this.destroy = mockRendererDestroy;
      this.setDebugOptions = vi.fn();
      this.getWeatherPostProcessMode = vi.fn().mockReturnValue('fragment');
    });
  });

  afterEach(resetSearch);

  it('short-circuits on a successful WebGPU init without constructing GL weather', async () => {
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgpu');
    expect(MockedRenderer).toHaveBeenCalledTimes(1);
    expect(mockCallOrder).toEqual(['webgpu']);
  });

  it('hard-fails without constructing GL weather when WebGPU init fails', async () => {
    mockRendererInit.mockResolvedValue(false);
    mockWebgpuFallbackReason = 'Adapter limit maxTextureDimension2D=2048 below required 4096';
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(created.fallbackReason).toBe('Adapter limit maxTextureDimension2D=2048 below required 4096');
    expect(mockRendererDestroy).toHaveBeenCalledTimes(1);
    expect(mockCallOrder).toEqual(['webgpu']);
    expect(window.usingWebGL).toBe(false);
    expect(window.usingWebGPU).toBe(false);
    expect(window.rendererType).toBeUndefined();
    expect(window.rendererFallbackReason).toBe(created.fallbackReason);
  });

  it('still probes WebGPU only when ?renderer=webgl is set (no live GL weather)', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgpu');
    expect(mockCallOrder).toEqual(['webgpu']);
    expect(window.webgpuProbe?.webglPreferenceDeferred).toBe(true);
  });

  it('hard-fails on webgl preference when WebGPU also fails — still no GL weather', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    mockRendererInit.mockResolvedValue(false);
    mockWebgpuFallbackReason = 'WebGPU is not supported in this browser';
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(window.usingWebGL).toBe(false);
  });

  it('sets window.rendererType and window.streetViewRendererDebug on a successful init', async () => {
    const canvas = document.createElement('canvas');
    await createStreetViewRenderer(canvas);

    expect(window.rendererType).toBe('webgpu');
    expect(window.streetViewRendererDebug).toBeDefined();
    expect(window.streetViewRendererDebug?.getBackend().rendererType).toBe('webgpu');
  });

  it('passes legacyTransitions=false by default and true when URL flag is enabled', async () => {
    const canvas = document.createElement('canvas');

    await createStreetViewRenderer(canvas);
    expect(mockRendererInit).toHaveBeenLastCalledWith(
      expect.objectContaining({ legacyTransitions: false })
    );

    window.history.pushState({}, '', '/?legacyTransitions=1');
    await createStreetViewRenderer(canvas);
    expect(mockRendererInit).toHaveBeenLastCalledWith(
      expect.objectContaining({ legacyTransitions: true })
    );
  });

  it('does not import a live GL weather class from production renderer sources', () => {
    const root = join(__dirname);
    const hits: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'webgl') continue;
          collect(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (text.includes('WebGLFallbackRenderer') || /from ['"].*webgl\/weatherReference/.test(text)) {
            hits.push(full.replace(`${root}/`, ''));
          }
        }
      }
    };
    collect(root);
    expect(hits).toEqual([]);
  });
});
