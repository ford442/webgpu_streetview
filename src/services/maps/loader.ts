/**
 * Singleton Google Maps JavaScript API loader.
 *
 * - Idempotent: subsequent calls return the same Promise.
 * - URL matches the deployed working version: ?key=<KEY>&v=3.56
 *   (no `callback` param, no `libraries`).
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

/**
 * Load the Google Maps JavaScript API.
 *
 * Subsequent calls with the same (or any) key return the same Promise — the
 * script is injected at most once per page.
 *
 * @param apiKey  Maps API key.  If empty the promise rejects immediately.
 */
export function loadMapsApi(apiKey: string): Promise<void> {
  // Guard: empty key or obvious placeholder — reject immediately with a clear
  // message rather than passing the value to Google Maps and triggering the
  // "This page can't load Google Maps correctly" error overlay.
  const isPlaceholder = PLACEHOLDER_KEY_PATTERNS.some(re => re.test(apiKey?.trim() || ''));
  if (!apiKey || isPlaceholder) {
    const reason = isPlaceholder ? 'placeholder value detected' : 'key is empty';
    const msg =
      `[Maps Loader] Google Maps API key not configured (${reason}). ` +
      'Set window.MAPS_API_KEY in public/config.js (runtime, no rebuild needed) ' +
      'or set REACT_APP_MAPS_API_KEY in .env.local and rebuild. ' +
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
    // Match the deployed working bundle: v=3.56, no callback, no libraries.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=3.56`;
    script.async = true;

    script.onload = () => {
      if (window.google?.maps) {
        // Schedule a verification pass. Google sometimes injects a visible error
        // overlay into map containers (or the body) asynchronously even after the
        // script "loads", especially for referrer/billing/auth failures.
        // If we detect the classic error text, treat it as an auth failure so the
        // app can show a clear actionable message instead of the confusing Google UI.
        setTimeout(() => {
          const bodyText = (document.body && document.body.innerText) || '';
          const hasClassicError =
            /This page can['’]t load Google Maps correctly/i.test(bodyText) ||
            /无法正确加载 Google 地图/i.test(bodyText) ||
            /Do you own this website/i.test(bodyText);

          if (hasClassicError) {
            console.error(
              '[Maps Loader] Detected Google Maps authentication error UI in DOM after script load. ' +
              'This almost always means: (1) HTTP referrer restriction on the key does not include the current origin, ' +
              '(2) billing is not enabled / payment method issue on the GCP project, or (3) Maps JavaScript API is disabled for the key.'
            );
            // Fire the same listeners that gm_authFailure would have triggered.
            authFailureListeners.forEach(cb => {
              try { cb(); } catch (e) { console.error('[Maps Loader] Auth failure listener error (post-load scan):', e); }
            });
            // Do not resolve as success; downstream code (StreetView) will surface via onError + banners.
            // We resolve here only to avoid double-rejection in the promise chain, but the listeners have already
            // notified the app which will disable cruise and show the prominent banner.
          }
        }, 1200);

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
