import { useCallback, useEffect, useRef, useState } from 'react';
import type { RendererBackendType } from '../renderer/RendererBackend';
import type { MapsLoadStatus } from '../components/StreetView';
import { migrateLocalStorageToIndexedDB } from '../offline/offlinePersistence';

export type WebGpuConnectionStatus = 'initializing' | 'ready' | 'failed';

export interface UseAppConnectionParams {
  canvas: HTMLCanvasElement | null;
  mapsLoadStatus: MapsLoadStatus;
  setMapsLoadStatus: (status: MapsLoadStatus) => void;
}

export interface UseAppConnectionResult {
  showWelcome: boolean;
  isConnected: boolean;
  webGPUAvailable: boolean;
  webgpuStatus: WebGpuConnectionStatus;
  rendererBackendInfo: {
    backendType: RendererBackendType | null;
    fallbackReason?: string;
  } | null;
  isCanvasReady: boolean;
  navPending: boolean;
  setNavPending: React.Dispatch<React.SetStateAction<boolean>>;
  geocoderRef: React.MutableRefObject<google.maps.Geocoder | null>;
  handleStart: () => void;
  handleWebGPUStatus: (available: boolean) => void;
  handleBackendInfo: (info: {
    backendType: RendererBackendType | null;
    fallbackReason?: string;
  }) => void;
}

/**
 * Welcome/connected gate, canvas/WebGPU readiness, maps→rendering promotion,
 * and one-shot offline IndexedDB migration.
 *
 * WebGPU hard-fail (`webgpuStatus === 'failed'`) blocks promotion to
 * `rendering` and never elevates the raw Maps scraper as a weather rescue.
 */
export function useAppConnection({
  canvas,
  mapsLoadStatus,
  setMapsLoadStatus,
}: UseAppConnectionParams): UseAppConnectionResult {
  const [showWelcome, setShowWelcome] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [webGPUAvailable, setWebGPUAvailable] = useState(true);
  const [webgpuStatus, setWebgpuStatus] = useState<WebGpuConnectionStatus>('initializing');
  const [rendererBackendInfo, setRendererBackendInfo] = useState<{
    backendType: RendererBackendType | null;
    fallbackReason?: string;
  } | null>(null);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [navPending, setNavPending] = useState(false);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const handleWebGPUStatus = useCallback((available: boolean) => {
    setWebGPUAvailable(available);
    setWebgpuStatus(available ? 'ready' : 'failed');
  }, []);

  const handleBackendInfo = useCallback(
    (info: { backendType: RendererBackendType | null; fallbackReason?: string }) => {
      setRendererBackendInfo(info);
    },
    [],
  );

  useEffect(() => {
    void migrateLocalStorageToIndexedDB().catch((err) => {
      console.warn('[Offline] IndexedDB migration skipped:', err);
    });
  }, []);

  useEffect(() => {
    if (canvas && !isCanvasReady) {
      setIsCanvasReady(true);
      console.log('[App] Canvas is ready');
    }
  }, [canvas, isCanvasReady]);

  useEffect(() => {
    // Hard-fail: never promote Maps to "rendering" without a live WebGPU session.
    if (webgpuStatus === 'failed') return;
    if (
      isCanvasReady &&
      webgpuStatus !== 'initializing' &&
      mapsLoadStatus !== 'api-error' &&
      mapsLoadStatus !== 'canvas-timeout'
    ) {
      setMapsLoadStatus('rendering');
    }
  }, [isCanvasReady, mapsLoadStatus, webgpuStatus, setMapsLoadStatus]);

  const handleStart = useCallback(() => {
    setShowWelcome(false);
    setIsConnected(true);
  }, []);

  return {
    showWelcome,
    isConnected,
    webGPUAvailable,
    webgpuStatus,
    rendererBackendInfo,
    isCanvasReady,
    navPending,
    setNavPending,
    geocoderRef,
    handleStart,
    handleWebGPUStatus,
    handleBackendInfo,
  };
}
