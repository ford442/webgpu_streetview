import { createStreetViewRenderer } from './createStreetViewRenderer';
import { Renderer } from './Renderer';
import { WebGLFallbackRenderer } from './WebGLFallbackRenderer';
import { vi, type Mock } from 'vitest';

// Mock-prefixed names are required: vitest hoists vi.mock() factories above
// imports, so any out-of-scope variable referenced inside a factory must start
// with "mock".
const mockRendererInit = vi.fn();
const mockRendererDestroy = vi.fn();
const mockCallOrder: Array<'webgpu' | 'webgl'> = [];
let mockWebgpuFallbackReason: string | undefined;

vi.mock('./Renderer', () => ({ Renderer: vi.fn() }));
vi.mock('./WebGLFallbackRenderer', () => ({ WebGLFallbackRenderer: vi.fn() }));

const MockedRenderer = Renderer as unknown as Mock;
const MockedWebGLFallbackRenderer = WebGLFallbackRenderer as unknown as Mock;

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

    MockedWebGLFallbackRenderer.mockReset().mockImplementation(function () {
      mockCallOrder.push('webgl');
    });
  });

  afterEach(resetSearch);

  it('short-circuits on a successful WebGPU init without ever constructing WebGL', async () => {
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgpu');
    expect(MockedRenderer).toHaveBeenCalledTimes(1);
    expect(MockedWebGLFallbackRenderer).not.toHaveBeenCalled();
  });

  it('hard-fails without constructing WebGL when WebGPU init fails', async () => {
    mockRendererInit.mockResolvedValue(false);
    mockWebgpuFallbackReason = 'Adapter limit maxTextureDimension2D=2048 below required 4096';
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(created.fallbackReason).toBe('Adapter limit maxTextureDimension2D=2048 below required 4096');
    expect(mockRendererDestroy).toHaveBeenCalledTimes(1);
    expect(MockedWebGLFallbackRenderer).not.toHaveBeenCalled();
    expect(mockCallOrder).toEqual(['webgpu']);
    expect(window.usingWebGL).toBe(false);
    expect(window.usingWebGPU).toBe(false);
    expect(window.rendererType).toBeUndefined();
    expect(window.rendererFallbackReason).toBe(created.fallbackReason);
  });

  it('still probes WebGPU only when ?renderer=webgl is set (GL deferred)', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgpu');
    expect(MockedWebGLFallbackRenderer).not.toHaveBeenCalled();
    expect(mockCallOrder).toEqual(['webgpu']);
    expect(window.webgpuProbe?.webglPreferenceDeferred).toBe(true);
  });

  it('hard-fails on webgl preference when WebGPU also fails — still no WebGL construct', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    mockRendererInit.mockResolvedValue(false);
    mockWebgpuFallbackReason = 'WebGPU is not supported in this browser';
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(MockedWebGLFallbackRenderer).not.toHaveBeenCalled();
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
});
