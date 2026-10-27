/**
 * Cache naming. The worker's real names are `${CACHE_PREFIX}<content id>-static|runtime`
 * (id stamped at build time by scripts/stamp-sw.mjs). The prefix is deliberately not
 * plain `streetview-`: the scene-depth model's bucket must stay out of reach.
 */
export const CACHE_PREFIX = 'streetview-sw-';
/** Pre-stamping builds named their caches `streetview-v1-static|runtime`. */
export const LEGACY_CACHE_PREFIX = 'streetview-v1';

export type SwFetchStrategy = 'cache-first' | 'network-first' | 'network-only';

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
  return name.startsWith(CACHE_PREFIX) || name.startsWith(LEGACY_CACHE_PREFIX);
}
