/**
 * Clean Google Maps JavaScript API connection layer.
 *
 * - Idempotent: subsequent calls return the same Promise.
 * - URL uses ?key=<KEY>&v=weekly (v=3.56 is retired and spams RetiredVersion errors).
 * - Uses `script.onload` for initialization rather than a global callback.
 * - Installs `window.gm_authFailure` to surface key / referrer issues.
 * - Rejects immediately if the key is empty.
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
      status?: 'loading' | 'ready' | 'failed';
      ignoreAuthFailuresUntil?: number;
      lastAuthFailureKey?: string;
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

export interface MapsAuthFailureEvent {
  key: string;
  source: string;
  currentKey: string;
}

interface AuthFailureListener {
  cb: (event: MapsAuthFailureEvent) => void;
  forKey?: string;
}

/** Registered auth-failure callbacks */
const authFailureListeners: AuthFailureListener[] = [];

let overQuotaNotified = false;
let lastAuthFailureKey = '';
let currentAttemptKey = '';
let ignoreAuthFailuresUntil = 0;

const AUTH_FAILURE_IGNORE_WINDOW_MS = 1200;

/** Fire auth listeners once when Maps reports quota/billing exhaustion. */
function installOverQuotaGuard(): void {
  if (overQuotaNotified || (window as unknown as { __mapsOverQuotaGuard?: boolean }).__mapsOverQuotaGuard) {
    return;
  }
  (window as unknown as { __mapsOverQuotaGuard?: boolean }).__mapsOverQuotaGuard = true;

  const notifyOnce = () => {
    if (overQuotaNotified) return;
    overQuotaNotified = true;
    console.error('[Maps Loader] OverQuotaMapError — API quota exceeded or billing disabled');
    notifyAuthFailure('OverQuotaMapError');
  };

  // Google surfaces OverQuotaMapError via the global error event in some builds.
  window.addEventListener('error', (ev) => {
    const msg = String(ev.message || '');
    if (msg.includes('OverQuotaMapError') || msg.includes('OverQuota')) {
      notifyOnce();
    }
  });

  // Belt-and-suspenders: throttle repeated console.error spam from Maps internals.
  const orig = console.error.bind(console);
  let lastLog = 0;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (msg.includes('OverQuotaMapError') || msg.includes('OverQuota')) {
      const now = Date.now();
      if (now - lastLog < 3000) return;
      lastLog = now;
      notifyOnce();
      orig('[Maps Loader] OverQuotaMapError (subsequent errors suppressed for 3s)');
      return;
    }
    orig(...args);
  };
}

function getCurrentLoadKey(): string {
  return window.__mapsApiLoadState?.apiKey || currentAttemptKey || (window.MAPS_API_KEY || '').trim();
}

/**
 * Clears loader-local auth-failure state for the given key, or all keys when
 * omitted. Call this after a key change or after the current Maps bootstrap has
 * reached a known-good state.
 */
export function clearAuthFailure(forKey?: string): void {
  const normalizedKey = forKey?.trim();
  if (!normalizedKey) {
    ignoreAuthFailuresUntil = 0;
    currentAttemptKey = '';
  }
  if (!normalizedKey || normalizedKey === lastAuthFailureKey) {
    lastAuthFailureKey = '';
  }
  if (!normalizedKey || window.__mapsApiLoadState?.lastAuthFailureKey === normalizedKey) {
    if (window.__mapsApiLoadState) {
      window.__mapsApiLoadState.lastAuthFailureKey = '';
      if (window.__mapsApiLoadState.status === 'failed') {
        window.__mapsApiLoadState.status = 'loading';
      }
    }
  }
}

export function ignoreAuthFailuresFor(ms: number = AUTH_FAILURE_IGNORE_WINDOW_MS): void {
  ignoreAuthFailuresUntil = Math.max(ignoreAuthFailuresUntil, Date.now() + ms);
  if (window.__mapsApiLoadState) {
    window.__mapsApiLoadState.ignoreAuthFailuresUntil = ignoreAuthFailuresUntil;
  }
}

function shouldIgnoreAuthFailure(failedKey: string): boolean {
  const state = window.__mapsApiLoadState;
  const now = Date.now();
  const ignoreUntil = Math.max(ignoreAuthFailuresUntil, state?.ignoreAuthFailuresUntil || 0);

  if (now < ignoreUntil) {
    console.warn('[Maps Loader] Ignoring Maps auth failure during post-success debounce window');
    return true;
  }

  if (state?.apiKey && state.apiKey !== failedKey) {
    console.warn('[Maps Loader] Ignoring stale Maps auth failure for a previous key');
    return true;
  }

  return false;
}

function notifyAuthFailure(source: string, failedKey = getCurrentLoadKey()): void {
  const currentKey = getCurrentLoadKey();
  const normalizedFailedKey = failedKey.trim();
  if (shouldIgnoreAuthFailure(normalizedFailedKey)) {
    return;
  }

  lastAuthFailureKey = normalizedFailedKey;
  if (window.__mapsApiLoadState && window.__mapsApiLoadState.apiKey === normalizedFailedKey) {
    window.__mapsApiLoadState.status = 'failed';
    window.__mapsApiLoadState.lastAuthFailureKey = normalizedFailedKey;
  }

  console.error(`[Maps Loader] ${source} — API key invalid, referrer-blocked, billing disabled, or API not enabled`);
  const event: MapsAuthFailureEvent = {
    key: normalizedFailedKey,
    source,
    currentKey,
  };
  authFailureListeners.forEach(listener => {
    if (listener.forKey && listener.forKey !== event.key) return;
    try {
      listener.cb(event);
    } catch (e) {
      console.error('[Maps Loader] Auth failure listener error:', e);
    }
  });
}

/**
 * Register a callback that will be invoked when Google Maps signals an
 * authentication failure (invalid key, referrer restriction, billing disabled).
 *
 * @returns An unsubscribe function.
 */
export function onMapsAuthFailure(
  cb: (event: MapsAuthFailureEvent) => void,
  options?: { forKey?: string }
): () => void {
  const listener: AuthFailureListener = { cb, forKey: options?.forKey?.trim() };
  authFailureListeners.push(listener);
  return () => {
    const idx = authFailureListeners.indexOf(listener);
    if (idx !== -1) authFailureListeners.splice(idx, 1);
  };
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

  installOverQuotaGuard();

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

  const trimmedKey = apiKey.trim();

  if (window.google?.maps?.Map && window.google.maps.StreetViewPanorama) {
    currentAttemptKey = trimmedKey;
    clearAuthFailure(trimmedKey);
    ignoreAuthFailuresFor();
    window.__mapsApiLoadState = {
      apiKey: trimmedKey,
      promise: Promise.resolve(),
      status: 'ready',
      ignoreAuthFailuresUntil,
      lastAuthFailureKey: '',
    };
    return Promise.resolve();
  }

  if (window.__mapsApiLoadState) {
    if (window.__mapsApiLoadState.apiKey !== trimmedKey) {
      console.warn('[Maps Loader] Maps API is already loading with a different runtime key; reusing the in-flight connection.');
    }
    return window.__mapsApiLoadState.promise;
  }

  currentAttemptKey = trimmedKey;
  clearAuthFailure(trimmedKey);
  installAuthFailureHandler();

  const promise = new Promise<void>((resolve, reject) => {
    const unsubscribe = onMapsAuthFailure(() => {
      unsubscribe();
      reject(new Error('[Maps Loader] Google Maps authentication failed. Check referrer restrictions, billing, and enabled APIs.'));
    }, { forKey: trimmedKey });

    createBootstrapScript(trimmedKey)
      .then(importRequiredLibraries)
      .then(() => {
        unsubscribe();
        if (window.__mapsApiLoadState?.apiKey === trimmedKey) {
          window.__mapsApiLoadState.status = 'ready';
          window.__mapsApiLoadState.lastAuthFailureKey = '';
        }
        clearAuthFailure(trimmedKey);
        ignoreAuthFailuresFor();
        resolve();
      })
      .catch((err) => {
        unsubscribe();
        if (window.__mapsApiLoadState?.apiKey === trimmedKey) {
          window.__mapsApiLoadState.status = 'failed';
          window.__mapsApiLoadState.lastAuthFailureKey = trimmedKey;
        }
        reject(err);
      });
  })
    .catch(err => {
      removeFailedBootstrap();
      throw err;
    });

  window.__mapsApiLoadState = {
    apiKey: trimmedKey,
    promise,
    status: 'loading',
    ignoreAuthFailuresUntil,
    lastAuthFailureKey: '',
  };
  return promise;
}
