import type { MapsLoadStatus } from '../components/StreetView';
import {
  scraperHealthUserMessage,
  type ScraperHealth,
} from '../utils/scraperHealth';

export interface MapsLoadingOverlayConfig {
  isVisible: boolean;
  message: string;
  progress?: number;
  error?: string;
  retryable?: boolean;
  onRetry?: () => void;
}

export interface BuildMapsLoadingOverlayParams {
  isConnected: boolean;
  effectiveMapsKey: string;
  mapsLoadStatus: MapsLoadStatus;
  isRetryingMapsAuth: boolean;
  webgpuStatus: 'initializing' | 'ready' | 'fallback';
  isCanvasReady: boolean;
  canvasError: string | null;
  mapsAuthError: string | null;
  scraperHealth: ScraperHealth;
  handleRetryMapsAuth: () => void;
}

/**
 * Derives LoadingOverlay props from Maps bootstrap + scraper health + renderer readiness.
 * Returns null when the app is not connected (welcome screen).
 *
 * Failure copy is intentionally distinct:
 *  - api-error / auth-blocked → Maps key / referrer
 *  - scrape lost / timeout → canvas scrape
 *  - WebGPU strings live in scraperHealth.WEBGPU_FAILURE_USER_MESSAGE (renderer chip)
 */
export function buildMapsLoadingOverlay(
  params: BuildMapsLoadingOverlayParams,
): MapsLoadingOverlayConfig | null {
  const {
    isConnected,
    effectiveMapsKey,
    mapsLoadStatus,
    isRetryingMapsAuth,
    webgpuStatus,
    isCanvasReady,
    canvasError,
    mapsAuthError,
    scraperHealth,
    handleRetryMapsAuth,
  } = params;

  if (!isConnected) return null;

  if (!effectiveMapsKey) {
    return {
      isVisible: true,
      message: '',
      error:
        'No Google Maps API key is configured. Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with MAPS_API_KEY=... python deploy.py.',
      retryable: true,
      onRetry: handleRetryMapsAuth,
    };
  }

  // Mid-session scrape loss (after we previously had a stable canvas).
  if (
    scraperHealth.everStable &&
    scraperHealth.status === 'lost' &&
    mapsLoadStatus !== 'api-error'
  ) {
    return {
      isVisible: true,
      message: 'Reconnecting Street View canvas…',
      error: scraperHealthUserMessage(scraperHealth) || undefined,
      progress: 60,
      retryable: true,
      onRetry: () => window.location.reload(),
    };
  }

  // Auth failures only while status is api-error — do not block loading-api retries
  // with a stale auth-blocked scraperHealth snapshot.
  if (mapsLoadStatus === 'api-error') {
    return {
      isVisible: true,
      message: '',
      error:
        mapsAuthError ||
        (scraperHealth.status === 'auth-blocked'
          ? scraperHealthUserMessage(scraperHealth)
          : null) ||
        canvasError ||
        'Failed to load Google Maps API. Please check your API key and network connection.',
      retryable: true,
      onRetry: handleRetryMapsAuth,
    };
  }

  switch (mapsLoadStatus) {
    case 'loading-api':
      return {
        isVisible: true,
        message: isRetryingMapsAuth ? 'Retrying with new key...' : 'Connecting to Google Maps...',
        progress: isRetryingMapsAuth ? 20 : 15,
      };
    case 'api-ready':
      return {
        isVisible: true,
        message: isRetryingMapsAuth
          ? 'New key accepted. Preparing Street View...'
          : 'Google Maps connected. Preparing Street View...',
        progress: 35,
      };
    case 'loading-panorama':
      return {
        isVisible: true,
        message:
          scraperHealth.status === 'promoting'
            ? 'Stabilizing Street View imagery…'
            : 'Loading Street View...',
        progress: scraperHealth.status === 'promoting' ? 70 : 55,
      };
    case 'canvas-ready':
      return {
        isVisible: webgpuStatus === 'initializing',
        message: 'Preparing WebGPU renderer...',
        progress: 85,
      };
    case 'canvas-timeout':
      return {
        isVisible: true,
        message: '',
        error:
          canvasError ||
          (scraperHealth.status === 'timeout'
            ? scraperHealthUserMessage(scraperHealth)
            : null) ||
          'Street View unavailable at this location.',
        retryable: true,
        onRetry: () => window.location.reload(),
      };
    case 'idle':
      if (scraperHealth.status === 'timeout') {
        return {
          isVisible: true,
          message: '',
          error:
            canvasError ||
            scraperHealthUserMessage(scraperHealth) ||
            'Street View unavailable at this location.',
          retryable: true,
          onRetry: () => window.location.reload(),
        };
      }
      return { isVisible: !isCanvasReady, message: 'Preparing Maps connection...', progress: 5 };
    case 'rendering':
    default:
      return { isVisible: false, message: '' };
  }
}
