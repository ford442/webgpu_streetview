import { createStreetViewRenderer } from './createStreetViewRenderer';

// No mocking here on purpose: jsdom provides `navigator.gpu === undefined`
// so the real WebGPU Renderer fails its own internal guard. WebGL weather is
// no longer constructed as a rescue — hard-fail is the expected contract.
describe('createStreetViewRenderer (real backends, no GPU in jsdom)', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(resetSearch);
  afterEach(resetSearch);

  it('hard-fails with no renderer when WebGPU cannot initialize', async () => {
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(created.fallbackReason).toMatch(/WebGPU/i);
    expect(created.debugOptions).toEqual({ effectIsolation: 'all', wireframe: false });
    expect(window.usingWebGL).toBe(false);
    expect(window.webgpuProbe?.ok).toBe(false);
  });

  it('does not throw and resolves a default debugOptions object even with URL overrides', async () => {
    window.history.pushState({}, '', '/?renderer=webgl&effect=fog&wireframe');
    const canvas = document.createElement('canvas');
    const created = await createStreetViewRenderer(canvas);

    expect(created.renderer).toBeNull();
    expect(created.backendType).toBeNull();
    expect(created.debugOptions).toEqual({ effectIsolation: 'fog', wireframe: true });
    expect(window.usingWebGL).toBe(false);
    expect(window.webgpuProbe?.webglPreferenceDeferred).toBe(true);
  });
});
