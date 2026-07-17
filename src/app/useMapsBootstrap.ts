import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import type { MapsLoadStatus } from '../components/StreetView';
import {
  clearAuthFailure,
  loadMapsApi,
  onMapsAuthFailure,
  removeFailedBootstrap,
} from '../services/maps/loader';
import { getConfiguredMapsKey, INITIAL_MAPS_KEY } from './mapsKeyUtils';

const GM_ERR_SELECTOR =
  '.streetview-scraper [class*="gm-err"], .streetview-scraper .gm-err-container, .streetview-scraper .gm-err-content, .streetview-scraper .gm-err-icon, .streetview-scraper .gm-err-title, .streetview-scraper .gm-err-message, .streetview-scraper [aria-label*="Google Maps" i]';

function suppressGmErrNodes(root: ParentNode, selector: string): void {
  root.querySelectorAll(selector).forEach((n) => {
    const e = n as HTMLElement;
    e.style.setProperty('display', 'none', 'important');
    e.style.setProperty('visibility', 'hidden', 'important');
    e.style.setProperty('opacity', '0', 'important');
    if (e.parentNode) {
      try {
        e.parentNode.removeChild(e);
      } catch {
        /* ignore detached nodes */
      }
    }
  });
}

export interface UseMapsBootstrapOptions {
  /** Called when gm_authFailure fires (e.g. disable cruise mode). */
  onAuthFailure?: () => void;
}

export interface MapsBootstrapState {
  effectiveMapsKey: string;
  mapsLoadStatus: MapsLoadStatus;
  setMapsLoadStatus: (status: MapsLoadStatus) => void;
  mapsAuthFailed: boolean;
  mapsAuthError: string | null;
  isRetryingMapsAuth: boolean;
  showMissingKeyBanner: boolean;
  setShowMissingKeyBanner: (show: boolean) => void;
  showAuthFailedBanner: boolean;
  setShowAuthFailedBanner: (show: boolean) => void;
  canvasError: string | null;
  setCanvasError: (error: string | null) => void;
  scraperRef: RefObject<HTMLDivElement | null>;
  handleMapsStatusChange: (status: MapsLoadStatus) => void;
  handleRetryMapsAuth: () => void;
  dismissAuthBlock: () => void;
}

/**
 * Maps API key resolution, auth recovery, late-key polling, and gm-err suppression.
 */
export function useMapsBootstrap(options: UseMapsBootstrapOptions = {}): MapsBootstrapState {
  const { onAuthFailure } = options;

  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [mapsLoadStatus, setMapsLoadStatus] = useState<MapsLoadStatus>(
    INITIAL_MAPS_KEY ? 'idle' : 'api-error',
  );
  const [mapsAuthFailed, setMapsAuthFailed] = useState(false);
  const [mapsAuthError, setMapsAuthError] = useState<string | null>(null);
  const [isRetryingMapsAuth, setIsRetryingMapsAuth] = useState(false);
  const [effectiveMapsKey, setEffectiveMapsKey] = useState<string>(INITIAL_MAPS_KEY);
  const [showMissingKeyBanner, setShowMissingKeyBanner] = useState(!INITIAL_MAPS_KEY);
  const [showAuthFailedBanner, setShowAuthFailedBanner] = useState(false);

  const scraperRef = useRef<HTMLDivElement | null>(null);
  const onAuthFailureRef = useRef(onAuthFailure);
  onAuthFailureRef.current = onAuthFailure;

  const handleMapsStatusChange = useCallback((status: MapsLoadStatus) => {
    setMapsLoadStatus(status);
    if (status !== 'api-error' && status !== 'canvas-timeout') {
      setCanvasError(null);
      setMapsAuthFailed(false);
      setMapsAuthError(null);
      setShowAuthFailedBanner(false);
      if (status === 'api-ready' || status === 'canvas-ready' || status === 'rendering') {
        clearAuthFailure(getConfiguredMapsKey());
      }
      if (status === 'canvas-ready' || status === 'rendering') {
        setIsRetryingMapsAuth(false);
      }
    }
  }, []);

  const handleRetryMapsAuth = useCallback(() => {
    const nextKey = getConfiguredMapsKey();
    if (!nextKey) {
      setMapsAuthError(
        'No Google Maps API key is configured. Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with MAPS_API_KEY=... python deploy.py.',
      );
      setMapsLoadStatus('api-error');
      setShowMissingKeyBanner(true);
      return;
    }

    setIsRetryingMapsAuth(true);
    clearAuthFailure(nextKey);
    setMapsLoadStatus('loading-api');
    setMapsAuthFailed(false);
    setMapsAuthError(null);
    setShowAuthFailedBanner(false);
    setShowMissingKeyBanner(false);
    setEffectiveMapsKey(nextKey);
    removeFailedBootstrap();

    loadMapsApi(nextKey).catch((err) => {
      setIsRetryingMapsAuth(false);
      setMapsAuthFailed(true);
      setMapsLoadStatus('api-error');
      setShowAuthFailedBanner(true);
      setMapsAuthError(
        err instanceof Error
          ? err.message
          : 'Google Maps API key error — retry failed.',
      );
    });
  }, []);

  const dismissAuthBlock = useCallback(() => {
    setMapsAuthFailed(false);
    setMapsAuthError(null);
    setShowAuthFailedBanner(true);
  }, []);

  // Reactive key poller / listener: recovers from config.js race (#84).
  useEffect(() => {
    let stopped = false;
    const syncKey = () => {
      if (stopped) return;
      const k = getConfiguredMapsKey();
      if (k && k !== effectiveMapsKey) {
        console.log('[App] Late Maps API key detected — updating effective key');
        clearAuthFailure();
        removeFailedBootstrap();
        setEffectiveMapsKey(k);
        setMapsLoadStatus('loading-api');
        setIsRetryingMapsAuth(Boolean(effectiveMapsKey || mapsAuthFailed));
        setShowMissingKeyBanner(false);
        setMapsAuthFailed(false);
        setMapsAuthError(null);
        setShowAuthFailedBanner(false);
      }
    };
    const iv = setInterval(syncKey, 120);
    const onKeyReady = () => syncKey();
    window.addEventListener('maps-api-key-ready', onKeyReady);
    syncKey();
    return () => {
      stopped = true;
      clearInterval(iv);
      window.removeEventListener('maps-api-key-ready', onKeyReady);
    };
  }, [effectiveMapsKey, mapsAuthFailed]);

  // Subscribe to Maps API auth failures.
  useEffect(() => {
    const unsubscribe = onMapsAuthFailure((event) => {
      const currentKey = getConfiguredMapsKey() || effectiveMapsKey;
      if (event.key && currentKey && event.key !== currentKey) {
        console.warn('[App] Ignoring stale Maps auth failure for a previous key');
        return;
      }
      setMapsAuthFailed(true);
      setIsRetryingMapsAuth(false);
      setMapsAuthError(
        'Google Maps API key error — check referrer restrictions, billing, and enabled APIs in Google Cloud Console.',
      );
      setMapsLoadStatus('api-error');
      setShowAuthFailedBanner(true);
      onAuthFailureRef.current?.();
      suppressGmErrNodes(document, GM_ERR_SELECTOR);
      console.error('[App] Maps API auth failure — cruise mode disabled');
    });
    return unsubscribe;
  }, [effectiveMapsKey]);

  // Secondary live suppressor on the .streetview-scraper wrapper (defense-in-depth).
  useEffect(() => {
    let mo: MutationObserver | null = null;
    const run = () => {
      const root = scraperRef.current || document.querySelector('.streetview-scraper');
      if (!root) return;
      suppressGmErrNodes(root, '[class*="gm-err"], .gm-err-container, [aria-label*="Google" i]');
    };
    const t = setTimeout(() => {
      const root = scraperRef.current || document.querySelector('.streetview-scraper');
      if (root) {
        run();
        mo = new MutationObserver(run);
        mo.observe(root, { childList: true, subtree: true });
      }
    }, 50);
    return () => {
      clearTimeout(t);
      if (mo) mo.disconnect();
    };
  }, []);

  return {
    effectiveMapsKey,
    mapsLoadStatus,
    setMapsLoadStatus,
    mapsAuthFailed,
    mapsAuthError,
    isRetryingMapsAuth,
    showMissingKeyBanner,
    setShowMissingKeyBanner,
    showAuthFailedBanner,
    setShowAuthFailedBanner,
    canvasError,
    setCanvasError,
    scraperRef,
    handleMapsStatusChange,
    handleRetryMapsAuth,
    dismissAuthBlock,
  };
}
