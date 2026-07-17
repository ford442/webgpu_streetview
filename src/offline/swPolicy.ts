/** Cache naming — bump CACHE_VERSION when precache/runtime strategy changes. */
export const CACHE_VERSION = 'streetview-v1';
export const STATIC_CACHE = `${CACHE_VERSION}-static`;
export const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

export type SwFetchStrategy = 'cache-first' | 'network-first' | 'network-only';

/** Known static assets to precache on service-worker install (relative to app root). */
export const PRECACHE_URLS: string[] = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './asset-manifest.json',
  './shaders/streetview.wgsl',
  './shaders/weather-post.wgsl',
  './shaders/weather-post-compute.wgsl',
  './shaders/carview.wgsl',
  './shaders/texture.wgsl',
  './shaders/transition-fade.wgsl',
  './shaders/transition-zoom.wgsl',
  './shaders/transition-zoom-blur.wgsl',
  './shaders/transition-zoom-chromatic.wgsl',
  './wasm/streetview-wasm.js',
  './icons/icon.svg',
];

const GOOGLE_HOST_RE = /(^|\.)google(?:apis)?\.com$|(^|\.)gstatic\.com$/;

/**
 * Decide how the service worker should handle a GET request.
 * Returns null when the SW should not intercept (browser default).
 */
export function resolveSwFetchStrategy(url: string, method: string, pageOrigin: string): SwFetchStrategy | null {
  if (method !== 'GET') return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (GOOGLE_HOST_RE.test(parsed.hostname)) {
    return 'network-only';
  }

  if (parsed.origin !== pageOrigin) {
    return null;
  }

  const path = parsed.pathname;

  if (path.includes('/static/')) return 'cache-first';
  if (path.includes('/shaders/') && path.endsWith('.wgsl')) return 'cache-first';
  if (path.includes('/wasm/')) return 'cache-first';
  if (path.endsWith('/manifest.json') || path.endsWith('/asset-manifest.json')) return 'cache-first';
  if (path.endsWith('/icons/') || path.includes('/icons/')) return 'cache-first';
  if (path.endsWith('/config.js')) return 'network-first';

  const isNavigation =
    path.endsWith('/') ||
    path.endsWith('/index.html') ||
    path.endsWith('/streetview/') ||
    path.endsWith('/streetview/index.html') ||
    (!path.includes('.') && !path.endsWith('.js') && !path.endsWith('.css'));

  if (isNavigation) return 'network-first';

  return null;
}

export function isOfflineCacheName(name: string): boolean {
  return name.startsWith(CACHE_VERSION);
}
