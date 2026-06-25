import { createStreetViewRenderer } from './createStreetViewRenderer';

// No mocking here on purpose: jsdom provides `canvas.getContext('webgl2') === null`
// and `navigator.gpu === undefined` out of the box, so both real backends already
// fail their own internal guards. This exercises the genuine "no GPU available"
// fallback path without needing any WebGPU/WebGL mocking infrastructure.
describe('createStreetViewRenderer (real backends, no GPU in jsdom)', () => {
  const resetSearch = () => window.history.pushState({}, '', '/');

  beforeEach(resetSearch);
  afterEach(resetSearch);

  it('resolves gracefully with no renderer when neither backend can initialize', async () => {
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.renderer).toBeNull();
    expect(result.backendType).toBeNull();
    expect(result.fallbackReason).toBe('WebGL2 renderer failed to initialize');
    expect(result.debugOptions).toEqual({ effectIsolation: 'all', wireframe: false });
  });

  it('does not throw and resolves a default debugOptions object even with URL overrides', async () => {
    window.history.pushState({}, '', '/?renderer=webgl&effect=fog&wireframe');
    const canvas = document.createElement('canvas');
    const result = await createStreetViewRenderer(canvas);

    expect(result.renderer).toBeNull();
    expect(result.backendType).toBeNull();
    expect(result.debugOptions).toEqual({ effectIsolation: 'fog', wireframe: true });
  });
});
