/**
 * Clean Google Maps JavaScript API connection layer.
 *
 * Uses Google's current dynamic-library loading model instead of the older
 * "direct script + onload" flow.  The loader installs a tiny bootstrap once,
 * asks Maps for only the libraries this app needs, and exposes a single
 * idempotent Promise to React components.
 */

declare global {
  interface Window {
    /** Called by Google Maps SDK when the key is invalid or referrer-blocked. */
    gm_authFailure?: () => void;
    google?: typeof google;
    /** Internal: cached in-flight load promise and key metadata. */
    __mapsApiLoadState?: {
      apiKey: string;
      promise: Promise<void>;
    };
    /** Internal: callback name used by the dynamic Maps bootstrap. */
    __initWebGpuStreetviewMaps?: () => void;
    /**
     * Runtime API key injected by public/config.js before the React bundle
     * loads. Takes precedence over the build-time REACT_APP_MAPS_API_KEY env var.
     */
    MAPS_API_KEY?: string;
  }
}

/**
 * Patterns that identify well-known placeholder / template values that are
 * NOT real API keys. Treated the same as an empty key — the loader will
 * reject immediately rather than pass the placeholder to Google Maps and
 * trigger the confusing "This page can't load Google Maps correctly" overlay.
 */
const PLACEHOLDER_KEY_PATTERNS: RegExp[] = [
  /^your[_-]?(google[_-]?)?maps[_-]?api[_-]?key[_-]?(here)?$/i,
  /^YOUR_MAPS_API_KEY$/,
  /^placeholder$/i,
  /^<.*>$/,          // angle-bracket templates like <YOUR_KEY>
  /^AIzaSy-placeholder/i,
];

const MAPS_SCRIPT_ID = 'webgpu-streetview-google-maps-js';
const MAPS_CALLBACK_NAME = '__initWebGpuStreetviewMaps';

/** Registered auth-failure callbacks */
const authFailureListeners: Array<() => void> = [];

/**
 * Register a callback that will be invoked when Google Maps signals an
 * authentication failure (invalid key, referrer restriction, billing disabled).
 *
 * @returns An unsubscribe function.
 */
export function onMapsAuthFailure(cb: () => void): () => void {
  authFailureListeners.push(cb);
  return () => {
    const idx = authFailureListeners.indexOf(cb);
    if (idx !== -1) authFailureListeners.splice(idx, 1);
  };
}

function notifyAuthFailure(source: string): void {
  console.error(`[Maps Loader] ${source} — API key invalid, referrer-blocked, billing disabled, or API not enabled`);
  authFailureListeners.forEach(cb => {
    try {
      cb();
    } catch (e) {
      console.error('[Maps Loader] Auth failure listener error:', e);
    }
  });
}

function installAuthFailureHandler(): void {
  window.gm_authFailure = () => notifyAuthFailure('gm_authFailure');
}

function getKeyConfigurationError(apiKey: string): string | null {
  const trimmed = apiKey?.trim() || '';
  const isPlaceholder = PLACEHOLDER_KEY_PATTERNS.some(re => re.test(trimmed));

  if (!trimmed || isPlaceholder) {
    const reason = isPlaceholder ? 'placeholder value detected' : 'key is empty';
    return (
      `[Maps Loader] Google Maps API key not configured (${reason}). ` +
      'Set window.MAPS_API_KEY in public/config.js (runtime, no rebuild needed) ' +
      'or set REACT_APP_MAPS_API_KEY in .env.local and rebuild. ' +
      'The Maps API will not load.'
    );
  }

  return null;
}

export function removeFailedBootstrap(): void {
  const script = document.getElementById(MAPS_SCRIPT_ID);
  if (script?.parentElement) {
    script.parentElement.removeChild(script);
  }
  delete window.__mapsApiLoadState;
  delete window.__initWebGpuStreetviewMaps;
}

function createBootstrapScript(apiKey: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(MAPS_SCRIPT_ID) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('[Maps Loader] Existing Maps bootstrap failed to load')), { once: true });
      return;
    }

    window.__initWebGpuStreetviewMaps = () => resolve();

    const params = new URLSearchParams({
      key: apiKey.trim(),
      v: 'weekly',
      loading: 'async',
      callback: MAPS_CALLBACK_NAME,
    });

    const script = document.createElement('script');
    script.id = MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error('[Maps Loader] Failed to load Google Maps API script'));
    document.head.appendChild(script);
  });
}

async function importRequiredLibraries(): Promise<void> {
  const importLibrary = window.google?.maps?.importLibrary;
  if (!importLibrary) {
    throw new Error('[Maps Loader] google.maps.importLibrary is unavailable after script load');
  }

  await Promise.all([
    importLibrary('maps'),
    importLibrary('streetView'),
  ]);
}

/**
 * Load the Google Maps JavaScript API and the app's required libraries.
 *
 * Subsequent calls with the same key return the same Promise.  If a previous
 * load failed, the failed bootstrap is removed so a later runtime-key update can
 * retry without a full page refresh.
 *
 * @param apiKey Maps API key. If empty the promise rejects immediately.
 */
export function loadMapsApi(apiKey: string): Promise<void> {
  const keyError = getKeyConfigurationError(apiKey);
  if (keyError) {
    console.warn(keyError);
    return Promise.reject(new Error(keyError));
  }

  if (window.google?.maps?.Map && window.google.maps.StreetViewPanorama) {
    return Promise.resolve();
  }

  const trimmedKey = apiKey.trim();
  if (window.__mapsApiLoadState) {
    if (window.__mapsApiLoadState.apiKey !== trimmedKey) {
      console.warn('[Maps Loader] Maps API is already loading with a different runtime key; reusing the in-flight connection.');
    }
    return window.__mapsApiLoadState.promise;
  }

  installAuthFailureHandler();

  const promise = new Promise<void>((resolve, reject) => {
    const unsubscribe = onMapsAuthFailure(() => {
      unsubscribe();
      reject(new Error('[Maps Loader] Google Maps authentication failed. Check referrer restrictions, billing, and enabled APIs.'));
    });

    createBootstrapScript(trimmedKey)
      .then(importRequiredLibraries)
      .then(() => {
        unsubscribe();
        resolve();
      })
      .catch((err) => {
        unsubscribe();
        reject(err);
      });
  })
    .catch(err => {
      removeFailedBootstrap();
      throw err;
    });

  window.__mapsApiLoadState = { apiKey: trimmedKey, promise };
  return promise;
}
