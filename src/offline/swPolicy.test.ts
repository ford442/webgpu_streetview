import { resolveSwFetchStrategy, isOfflineCacheName, PRECACHE_URLS } from './swPolicy';

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
    expect(resolveSwFetchStrategy(`${origin}/streetview/wasm/streetview-wasm.js`, 'GET', origin)).toBe(
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
    expect(isOfflineCacheName('streetview-v1-static')).toBe(true);
    expect(isOfflineCacheName('other-cache')).toBe(false);
  });

  it('precaches shader and wasm paths', () => {
    expect(PRECACHE_URLS.some((url) => url.includes('streetview.wgsl'))).toBe(true);
    expect(PRECACHE_URLS.some((url) => url.includes('streetview-wasm.js'))).toBe(true);
  });
});
