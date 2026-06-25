// Mock-prefixed names are required here: jest hoists jest.mock() factories above
// imports, so any out-of-scope variable referenced inside a factory must start
// with "mock" or Jest throws an out-of-scope-variable error.
const mockRendererInit = jest.fn();
const mockRendererDestroy = jest.fn();
const mockWebglInit = jest.fn();
const mockWebglDestroy = jest.fn();
const mockCallOrder: Array<'webgpu' | 'webgl'> = [];

// CRA's jest preset sets `resetMocks: true`, which calls jest.resetAllMocks()
// before every test and wipes out any `.mockImplementation()` configured here
// at factory-eval time. So the factories just install bare jest.fn()s, and the
// real per-backend behavior is (re-)installed in beforeEach below.
jest.mock('./Renderer', () => ({ Renderer: jest.fn() }));
jest.mock('./WebGLFallbackRenderer', () => ({ WebGLFallbackRenderer: jest.fn() }));

import { createStreetViewRenderer } from './createStreetViewRenderer';
import { Renderer } from './Renderer';
import { WebGLFallbackRenderer } from './WebGLFallbackRenderer';

const MockedRenderer = Renderer as unknown as jest.Mock;
const MockedWebGLFallbackRenderer = WebGLFallbackRenderer as unknown as jest.Mock;

describe('createStreetViewRenderer (mocked backend constructors)', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(() => {
    resetSearch();
    localStorage.clear();
    delete (window as any).rendererType;
    delete (window as any).streetViewRendererDebug;
    mockCallOrder.length = 0;

    mockRendererInit.mockReset().mockResolvedValue(true);
    mockRendererDestroy.mockReset();
    mockWebglInit.mockReset().mockResolvedValue(true);
    mockWebglDestroy.mockReset();

    MockedRenderer.mockReset().mockImplementation(function (this: any, canvas: HTMLCanvasElement) {
      mockCallOrder.push('webgpu');
      this.canvas = canvas;
      this.backendType = 'webgpu';
      this.fallbackReason = undefined;
      this.init = mockRendererInit;
      this.destroy = mockRendererDestroy;
      this.setDebugOptions = jest.fn();
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
      this.setDebugOptions = jest.fn();
    });
  });

  afterEach(resetSearch);

  it('short-circuits on a successful WebGPU init without ever constructing WebGL', async () => {
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.backendType).toBe('webgpu');
    expect(MockedRenderer).toHaveBeenCalledTimes(1);
    expect(MockedWebGLFallbackRenderer).not.toHaveBeenCalled();
  });

  it('falls back to WebGL and destroys the failed WebGPU renderer when WebGPU init fails', async () => {
    mockRendererInit.mockResolvedValue(false);
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.backendType).toBe('webgl');
    expect(mockRendererDestroy).toHaveBeenCalledTimes(1);
    expect(mockCallOrder).toEqual(['webgpu', 'webgl']);
  });

  it('reverses attempt order to try WebGL first when ?renderer=webgl is set', async () => {
    window.history.pushState({}, '', '/?renderer=webgl');
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.backendType).toBe('webgl');
    expect(mockCallOrder[0]).toBe('webgl');
    expect(MockedRenderer).not.toHaveBeenCalled();
  });

  it('falls all the way through to null when both backends fail, destroying both', async () => {
    mockRendererInit.mockResolvedValue(false);
    mockWebglInit.mockResolvedValue(false);
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.renderer).toBeNull();
    expect(result.backendType).toBeNull();
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
