/* eslint-disable no-restricted-globals */
/**
 * Offline shell service worker — caches app assets (shaders, WASM, JS/CSS bundles)
 * on first visit. Never caches Google Maps tile or API responses (Maps ToS).
 *
 * Policy mirror: src/offline/swPolicy.ts (keep in sync when changing rules).
 */

// `.wasm` / `.wgsl` are cache-first under unhashed names, so the cache name must
// change whenever their bytes do. `scripts/stamp-sw.mjs` rewrites the two
// `@sw-stamp` lines in build/service-worker.js (id = hash of the shipped wasm +
// shaders + build version, list = the real shader set); these are dev defaults.
// Not plain 'streetview-': the scene-depth model has its own bucket
// ('streetview-depth-model-…') that activate must never delete.
const CACHE_PREFIX = 'streetview-sw-';
const LEGACY_CACHE_PREFIX = 'streetview-v1';
const CACHE_ID = 'dev'; // @sw-stamp:cache-id
const SHADER_URLS = []; // @sw-stamp:shaders
const CACHE_VERSION = CACHE_PREFIX + CACHE_ID;
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// Keep the static part in sync with scripts/sw-manifest.mjs (STATIC_PRECACHE_URLS).
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  // Every main-thread kernel (SIMD128; the scalar build is a CI oracle only).
  './wasm/streetview-wasm.simd.wasm',
  // The cabin AudioWorklet's engine alone (fixed memory, < 32 KB).
  './wasm/streetview-dsp.simd.wasm',
  './icons/icon.svg',
].concat(SHADER_URLS);

const GOOGLE_HOST_RE = /(^|\.)google(?:apis)?\.com$|(^|\.)gstatic\.com$/;

function resolveStrategy(url, method) {
  if (method !== 'GET') return null;
  var parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  if (GOOGLE_HOST_RE.test(parsed.hostname)) return 'network-only';
  if (parsed.origin !== self.location.origin) return null;

  var path = parsed.pathname;
  if (path.indexOf('/static/') !== -1) return 'cache-first';
  if (path.indexOf('/shaders/') !== -1 && path.endsWith('.wgsl')) return 'cache-first';
  if (path.indexOf('/wasm/') !== -1) return 'cache-first';
  if (path.endsWith('/manifest.json') || path.endsWith('/asset-manifest.json')) return 'cache-first';
  if (path.indexOf('/icons/') !== -1) return 'cache-first';
  if (path.endsWith('/config.js')) return 'network-first';

  var isNavigation =
    path.endsWith('/') ||
    path.endsWith('/index.html') ||
    path.endsWith('/streetview/') ||
    path.endsWith('/streetview/index.html') ||
    (path.indexOf('.') === -1);

  if (isNavigation) return 'network-first';
  return null;
}

function cacheFirst(request) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return Response.error();
        });
    });
  });
}

function networkFirst(request) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return fetch(request)
      .then(function (response) {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(function () {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return cache.match('./index.html').then(function (shell) {
              if (shell) return shell;
              return cache.match('./').then(function (root) {
                return root || Response.error();
              });
            });
          }
          return Response.error();
        });
      });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function (cache) {
        // `reload`: bypass the HTTP cache so a new worker never precaches the
        // previous deploy's wasm/shaders from it.
        return cache.addAll(
          PRECACHE_URLS.map(function (url) {
            return new Request(url, { cache: 'reload' });
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function (err) {
        console.warn('[SW] Precache partial failure (will retry at runtime):', err);
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              var ours = key.indexOf(CACHE_PREFIX) === 0 || key.indexOf(LEGACY_CACHE_PREFIX) === 0;
              return ours && key !== STATIC_CACHE && key !== RUNTIME_CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  var strategy = resolveStrategy(event.request.url, event.request.method);
  if (!strategy || strategy === 'network-only') return;

  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (strategy === 'network-first') {
    event.respondWith(networkFirst(event.request));
  }
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
