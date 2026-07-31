import { createStreetViewRenderer } from './createStreetViewRenderer';
import { Renderer } from './Renderer';
import { WebGLFallbackRenderer } from './WebGLFallbackRenderer';
import { vi, type Mock } from 'vitest';

// Mock-prefixed names are required: vitest hoists vi.mock() factories above
// imports, so any out-of-scope variable referenced inside a factory must start
// with "mock".
const mockRendererInit = vi.fn();
const mockRendererDestroy = vi.fn();
const mockWebglInit = vi.fn();
const mockWebglDestroy = vi.fn();
const mockCallOrder: Array<'webgpu' | 'webgl'> = [];
let mockWebgpuFallbackReason: string | undefined;

vi.mock('./Renderer', () => ({ Renderer: vi.fn() }));
vi.mock('./WebGLFallbackRenderer', () => ({ WebGLFallbackRenderer: vi.fn() }));

const MockedRenderer = Renderer as unknown as Mock;
const MockedWebGLFallbackRenderer = WebGLFallbackRenderer as unknown as Mock;

describe('createStreetViewRenderer (mocked backend constructors)', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(() => {
    resetSearch();
    localStorage.clear();
    delete (window as any).rendererType;
    delete (window as any).streetViewRendererDebug;
    mockCallOrder.length = 0;
    mockWebgpuFallbackReason = undefined;

    mockRendererInit.mockReset().mockResolvedValue(true);
    mockRendererDestroy.mockReset();
    mockWebglInit.mockReset().mockResolvedValue(true);
    mockWebglDestroy.mockReset();

    MockedRenderer.mockReset().mockImplementation(function (this: any, canvas: HTMLCanvasElement) {
      mockCallOrder.push('webgpu');
      this.canvas = canvas;
      this.backendType = 'webgpu';
      this.fallbackReason = mockWebgpuFallbackReason;
      this.init = mockRendererInit;
      this.destroy = mockRendererDestroy;
      this.setDebugOptions = vi.fn();
    });

    MockedWebGLFallbackRenderer.mockReset().mockImplementation(function (
      this: any,
      canvas: HTMLCanvasElement,
      _debugOptions: unknown,
      fallbackReason?: string
    ) {
      mockCallOrder.push('webgl');
      this.canvas = canvas;
      this.backendType = 'webgl';
      this.fallbackReason = fallbackReason;
      this.init = mockWebglInit;
      this.destroy = mockWebglDestroy;
      this.setDebugOptions = vi.fn();
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

  it('falls back to WebGL and destroys the failed WebGPU renderer when WebGPU init fails', async () => {
    mockRendererInit.mockResolvedValue(false);
    mockWebgpuFallbackReason = 'Adapter limit maxTextureDimension2D=2048 below required 4096';
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgl');
    expect(created.fallbackReason).toBe('Adapter limit maxTextureDimension2D=2048 below required 4096');
    expect(mockRendererDestroy).toHaveBeenCalledTimes(1);
    expect(mockCallOrder).toEqual(['webgpu', 'webgl']);
  });

  it('reverses attempt order to try WebGL first when ?renderer=webgl is set', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.backendType).toBe('webgl');
    expect(mockCallOrder[0]).toBe('webgl');
    expect(MockedRenderer).not.toHaveBeenCalled();
  });

  it('falls all the way through to null when both backends fail, destroying both', async () => {
    mockRendererInit.mockResolvedValue(false);
    mockWebglInit.mockResolvedValue(false);
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(mockRendererDestroy).toHaveBeenCalledTimes(1);
    expect(mockWebglDestroy).toHaveBeenCalledTimes(1);
  });

  it('sets window.rendererType and window.streetViewRendererDebug on a successful init', async () => {
    const canvas = document.createElement('canvas');
    await createStreetViewRenderer(canvas);

    expect(window.rendererType).toBe('webgpu');
    expect(window.streetViewRendererDebug).toBeDefined();
    expect(window.streetViewRendererDebug?.getBackend().rendererType).toBe('webgpu');
  });
});
