/**
 * Singleton Google Maps JavaScript API loader.
 *
 * - Idempotent: subsequent calls return the same Promise.
 * - URL uses ?key=<KEY>&v=weekly (v=3.56 is retired and spams RetiredVersion errors).
 * - Uses `script.onload` for initialization rather than a global callback.
 * - Installs `window.gm_authFailure` to surface key / referrer issues.
 * - Rejects immediately if the key is empty.
 */

declare global {
  interface Window {
    /** Called by Google Maps SDK when the key is invalid or referrer-blocked. */
    gm_authFailure?: () => void;
    google?: typeof google;
    /** Internal: cached in-flight load promise. */
    __mapsApiPromise?: Promise<void>;
  }
}

/** Registered auth-failure callbacks */
const authFailureListeners: Array<() => void> = [];

let overQuotaNotified = false;

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
    authFailureListeners.forEach(cb => {
      try { cb(); } catch (e) { console.error('[Maps Loader] Auth failure listener error:', e); }
    });
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

/**
 * Load the Google Maps JavaScript API.
 *
 * Subsequent calls with the same (or any) key return the same Promise — the
 * script is injected at most once per page.
 *
 * @param apiKey  Maps API key.  If empty the promise rejects immediately.
 */
export function loadMapsApi(apiKey: string): Promise<void> {
  // Guard: empty key is a misconfiguration — reject immediately.
  if (!apiKey) {
    const msg =
      '[Maps Loader] REACT_APP_MAPS_API_KEY is not set. ' +
      'The Maps API will not load.';
    console.warn(msg);
    return Promise.reject(new Error(msg));
  }

  // Already fully loaded.
  if (window.google?.maps) {
    return Promise.resolve();
  }

  // Return the existing in-flight promise (singleton).
  if (window.__mapsApiPromise) {
    return window.__mapsApiPromise;
  }

  // Install the auth-failure handler exactly once, before injecting the script.
  if (!window.gm_authFailure) {
    window.gm_authFailure = () => {
      console.error(
        '[Maps Loader] gm_authFailure — API key invalid, referrer-blocked, or billing disabled'
      );
      authFailureListeners.forEach(cb => {
        try { cb(); } catch (e) { console.error('[Maps Loader] Auth failure listener error:', e); }
      });
    };
  }

  window.__mapsApiPromise = new Promise<void>((resolve, reject) => {
    // If a Maps script tag was already injected (e.g. by SSR or another bundle),
    // wait for it rather than injecting a second one.
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );
    if (existing) {
      if (window.google?.maps) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => {
        if (window.google?.maps) resolve();
        else reject(new Error('[Maps Loader] Existing script tag loaded but google.maps is undefined'));
      });
      existing.addEventListener('error', () =>
        reject(new Error('[Maps Loader] Existing script tag failed to load'))
      );
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    script.async = true;

    script.onload = () => {
      if (window.google?.maps) {
        installOverQuotaGuard();
        resolve();
      } else {
        reject(new Error('[Maps Loader] Script loaded but google.maps is undefined'));
      }
    };

    script.onerror = () => {
      reject(new Error('[Maps Loader] Failed to load Google Maps API script'));
    };

    document.head.appendChild(script);
  });

  return window.__mapsApiPromise;
}
