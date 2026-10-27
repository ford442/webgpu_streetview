import { resolveSwFetchStrategy, isOfflineCacheName } from './swPolicy';
import { DEPTH_MODEL_CACHE_NAME } from '../renderer/depth/depthModel';

describe('swPolicy', () => {
  const origin = 'https://test.1ink.us';

  it('never caches Google Maps hosts', () => {
    expect(resolveSwFetchStrategy('https://maps.googleapis.com/maps/api/js', 'GET', origin)).toBe(
      'network-only',
    );
    expect(resolveSwFetchStrategy('https://maps.gstatic.com/mapfiles/foo.png', 'GET', origin)).toBe(
      'network-only',
    );
  });

  it('cache-first for shaders, wasm, and static bundles', () => {
    expect(resolveSwFetchStrategy(`${origin}/streetview/shaders/streetview.wgsl`, 'GET', origin)).toBe(
      'cache-first',
    );
    expect(resolveSwFetchStrategy(`${origin}/streetview/wasm/streetview-wasm.wasm`, 'GET', origin)).toBe(
      'cache-first',
    );
    expect(resolveSwFetchStrategy(`${origin}/streetview/static/js/main.abc.js`, 'GET', origin)).toBe(
      'cache-first',
    );
  });

  it('network-first for config.js and navigation', () => {
    expect(resolveSwFetchStrategy(`${origin}/streetview/config.js`, 'GET', origin)).toBe('network-first');
    expect(resolveSwFetchStrategy(`${origin}/streetview/`, 'GET', origin)).toBe('network-first');
  });

  it('ignores non-GET and cross-origin app assets', () => {
    expect(resolveSwFetchStrategy(`${origin}/streetview/static/js/main.js`, 'POST', origin)).toBeNull();
    expect(resolveSwFetchStrategy('https://cdn.example.com/lib.js', 'GET', origin)).toBeNull();
  });

  it('flags offline cache names', () => {
    expect(isOfflineCacheName('streetview-sw-3f9a1c0b7d2e-static')).toBe(true);
    expect(isOfflineCacheName('streetview-sw-3f9a1c0b7d2e-runtime')).toBe(true);
    expect(isOfflineCacheName('streetview-v1-static')).toBe(true); // pre-stamping builds
    expect(isOfflineCacheName('other-cache')).toBe(false);
  });

  it('leaves the scene-depth model to its own Cache API bucket (#320)', () => {
    // Not intercepted: the depth Worker caches it once, verified, in a
    // versioned bucket — the SW must neither duplicate ~20–30 MB nor serve a
    // stale copy, and its activate() cleanup must never touch that bucket.
    expect(
      resolveSwFetchStrategy(`${origin}/streetview/models/depth/depth-anything-v2-small.q4f16.onnx`, 'GET', origin),
    ).toBeNull();
    expect(isOfflineCacheName(DEPTH_MODEL_CACHE_NAME)).toBe(false);
  });
});
