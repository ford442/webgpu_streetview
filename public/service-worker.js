/* eslint-disable no-restricted-globals */
/**
 * Offline shell service worker — caches app assets (shaders, WASM, JS/CSS bundles)
 * on first visit. Never caches Google Maps tile or API responses (Maps ToS).
 *
 * Policy mirror: src/offline/swPolicy.ts (keep in sync when changing rules).
 */
const CACHE_VERSION = 'streetview-v1';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './shaders/streetview.wgsl',
  './shaders/weather-post.wgsl',
  './shaders/weather-post-compute.wgsl',
  './shaders/carview.wgsl',
  './shaders/texture.wgsl',
  './shaders/transition-fade.wgsl',
  './shaders/transition-zoom.wgsl',
  './shaders/transition-zoom-blur.wgsl',
  './shaders/transition-zoom-chromatic.wgsl',
  './wasm/streetview-wasm.wasm',
  './icons/icon.svg',
];

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
      var network = fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
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
              return shell || cache.match('./');
            });
          }
          return undefined;
        });
      });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS);
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
              return key.indexOf(CACHE_VERSION) === 0 && key !== STATIC_CACHE && key !== RUNTIME_CACHE;
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
