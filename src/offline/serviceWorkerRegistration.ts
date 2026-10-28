import { PUBLIC_URL } from '../config/publicUrl';
const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/),
);

type ServiceWorkerConfig = {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
};

function registerValidSW(swUrl: string, config?: ServiceWorkerConfig) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.onstatechange = () => {
          if (installing.state !== 'installed') return;
          if (navigator.serviceWorker.controller) {
            config?.onUpdate?.(registration);
          } else {
            config?.onSuccess?.(registration);
          }
        };
      };
    })
    .catch((error) => {
      console.warn('[Offline] Service worker registration failed:', error);
    });
}

function checkValidServiceWorker(swUrl: string, config?: ServiceWorkerConfig) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then((response) => {
      const contentType = response.headers.get('content-type') ?? '';
      if (response.status === 404 || contentType.indexOf('javascript') === -1) {
        void navigator.serviceWorker.ready
          .then((registration) => registration.unregister())
          .then(() => window.location.reload());
        return;
      }
      registerValidSW(swUrl, config);
    })
    .catch(() => {
      console.warn('[Offline] No internet — service worker will use cached shell when available.');
    });
}

/**
 * Register the offline shell service worker.
 * Production builds only; the dev server opts in with `REACT_APP_ENABLE_SW=true`
 * (Lighthouse / manual PWA checks). A cache-first worker over Vite's moving dev
 * assets is a stale-bundle trap, and `localhost` alone is no reason to register one.
 */
export function registerServiceWorker(config?: ServiceWorkerConfig) {
  if (!('serviceWorker' in navigator)) return;

  const enableInDev = import.meta.env.VITE_PUBLIC_ENABLE_SW === 'true';
  if (!import.meta.env.PROD && !enableInDev) {
    return;
  }

  window.addEventListener('load', () => {
    const swUrl = `${PUBLIC_URL}/service-worker.js`;
    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      return;
    }
    registerValidSW(swUrl, config);
  });
}

export function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.ready.then((registration) => registration.unregister());
  }
}
