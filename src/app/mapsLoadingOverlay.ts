import type { MapsLoadStatus } from '../components/StreetView';

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
  handleRetryMapsAuth: () => void;
}

/**
 * Derives LoadingOverlay props from Maps bootstrap + renderer readiness state.
 * Returns null when the app is not connected (welcome screen).
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
      return { isVisible: true, message: 'Loading Street View...', progress: 55 };
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
        error: canvasError || 'Street View unavailable at this location.',
        retryable: true,
        onRetry: () => window.location.reload(),
      };
    case 'api-error':
      return {
        isVisible: true,
        message: '',
        error:
          mapsAuthError ||
          canvasError ||
          'Failed to load Google Maps API. Please check your API key and network connection.',
        retryable: true,
        onRetry: handleRetryMapsAuth,
      };
    case 'idle':
      return { isVisible: !isCanvasReady, message: 'Preparing Maps connection...', progress: 5 };
    case 'rendering':
    default:
      return { isVisible: false, message: '' };
  }
}
