import StreetView from '../../components/StreetView';
import { WebGPUCanvas, LoadingOverlay } from '../../components';
import { MainView } from '../../views';
import type { UseAppConnectionResult } from '../useAppConnection';
import type { MapsBootstrapState } from '../useMapsBootstrap';
import type { MapsLoadingOverlayConfig } from '../mapsLoadingOverlay';

export interface StreetViewStageProps {
  maps: MapsBootstrapState;
  connection: UseAppConnectionResult;
  setCanvas: (canvas: HTMLCanvasElement | null) => void;
  setPanorama: (pano: google.maps.StreetViewPanorama | null) => void;
  mapsLoadingOverlay: MapsLoadingOverlayConfig | null;
}

/** Hidden Maps scraper, WebGPU canvas, MainView, and loading overlay stack. */
export function StreetViewStage({
  maps,
  connection,
  setCanvas,
  setPanorama,
  mapsLoadingOverlay,
}: StreetViewStageProps) {
  return (
    <>
      <div
        ref={maps.scraperRef}
        className="streetview-scraper"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: connection.isConnected && connection.webGPUAvailable ? 0 : 2,
          opacity: 1,
          pointerEvents:
            connection.isConnected && connection.webGPUAvailable ? 'none' : 'auto',
        }}
      >
        <StreetView
          apiKey={maps.effectiveMapsKey}
          initialPosition={{ lat: 37.86926, lng: -122.254811 }}
          onCanvasReady={setCanvas}
          onError={maps.setCanvasError}
          onStatusChange={maps.handleMapsStatusChange}
          onPanoramaReady={(pano) => {
            setPanorama(pano);
            maps.setCanvasError(null);
            if (!connection.geocoderRef.current) {
              connection.geocoderRef.current = new google.maps.Geocoder();
            }
          }}
        />
      </div>

      {connection.isConnected && connection.isCanvasReady && (
        <WebGPUCanvas
          onWebGPUStatus={connection.handleWebGPUStatus}
          onBackendInfo={connection.handleBackendInfo}
        />
      )}

      <div
        id="main-content"
        role="main"
        aria-label="Street View Canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      >
        {connection.isConnected &&
          connection.isCanvasReady &&
          connection.webgpuStatus !== 'initializing' && (
            <MainView mapsApiKey={maps.effectiveMapsKey} />
          )}

        {mapsLoadingOverlay && (
          <LoadingOverlay
            isVisible={mapsLoadingOverlay.isVisible}
            message={mapsLoadingOverlay.message}
            progress={mapsLoadingOverlay.progress}
            error={mapsLoadingOverlay.error}
            retryable={mapsLoadingOverlay.retryable}
            onRetry={mapsLoadingOverlay.onRetry}
            size="fullscreen"
          />
        )}
      </div>
    </>
  );
}
