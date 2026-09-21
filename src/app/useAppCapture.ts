import { useCallback, useMemo } from 'react';
import type { ClipOverlaySource } from '../utils/canvasRecorder';
import { captureCompositedStill } from '../utils/canvasRecorder';
import { useSnapshots } from '../hooks/useSnapshots';
import { makePickerThumbDataUrl } from '../renderer/gpuChores/pickerThumb';
import type { StreetViewRenderer } from '../renderer/RendererBackend';
import { needsCabinOverlayLatch } from '../renderer/cabinComposite';
import type { LookId } from '../config/lookPacks';
import type { VehicleType } from '../car/VehicleManager';
import type { ConnectedChromeSnapshots } from './shell/ConnectedChrome';
import { getCarRuntime } from './carRuntimeCache';

export interface UseAppCaptureOptions {
  panorama: google.maps.StreetViewPanorama | null;
  renderer: StreetViewRenderer | null;
  viewMode: 'freelook' | 'car';
  heading: number;
  pitch: number;
  zoom: number;
  locationName: string;
  /** Historical image date of the pano on screen, if the timeline resolved one. */
  currentImageDate: string | null;
  lookId: LookId | null;
  vehicleType: VehicleType;
  teleportSafe: (lat: number, lng: number, heading: number, pitch: number) => Promise<void>;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
}

/**
 * Everything the snapshot gallery needs except the offline flags, which the
 * shell owns. Spread it: `{ ...capture.gallery, isOnline, hasServiceWorker }`.
 */
export type AppCaptureGallery = Omit<
  ConnectedChromeSnapshots,
  'isOnline' | 'hasServiceWorker'
>;

export interface UseAppCaptureResult {
  /**
   * Live cabin canvas for compositing. Stable for the life of the shell: it
   * reads `getCarRuntime()` at call time, so it is correct whether or not the
   * lazy car chunk has loaded. Before it does (or outside car mode) the canvas
   * is simply null and the capture is road-only.
   * See `car/runtime/frameCapture.ts`.
   *
   * **Only needed when the renderer is not already compositing the cabin.**
   * On the one-frame path (`renderer.isCabinCompositedInFrame()`, see
   * `renderer/cabinComposite.ts`) the road canvas *is* the composited frame,
   * so capture passes `null` instead and skips the latch entirely.
   */
  cabinOverlay: ClipOverlaySource;
  /** Capture the composited road + cabin frame into the snapshot gallery. */
  handleTakeSnapshot: () => void;
  /** Snapshot gallery bindings, ready to spread into `ConnectedChrome`. */
  gallery: AppCaptureGallery;
}

/**
 * Snapshot capture and the cabin overlay source that cinema clips share.
 *
 * Both stills and clips composite the same two layers — the graded road canvas
 * the WebGPU renderer owns, and the cabin canvas the lazy car runtime owns —
 * so the overlay source lives here next to the still capture rather than being
 * rebuilt per consumer.
 */
export function useAppCapture(options: UseAppCaptureOptions): UseAppCaptureResult {
  const {
    panorama,
    renderer,
    viewMode,
    heading,
    pitch,
    zoom,
    locationName,
    currentImageDate,
    lookId,
    vehicleType,
    teleportSafe,
    teleportToPanoSafe,
    setHeading,
    setPitch,
  } = options;

  const snapshots = useSnapshots();
  const { addSnapshot } = snapshots;

  const cabinOverlay = useMemo<ClipOverlaySource>(
    () => ({
      getCanvas: () => getCarRuntime()?.getCabinCanvas() ?? null,
      subscribe: (onRendered) => getCarRuntime()?.onCabinFrameRendered(onRendered) ?? (() => {}),
    }),
    [],
  );

  const handleTakeSnapshot = useCallback(() => {
    if (!panorama || !renderer) return;
    const position = panorama.getPosition();
    if (!position) return;
    const output = renderer.getOutputCanvas?.();
    const chores = renderer.getGpuChores?.();
    const downsample = chores
      ? (rgba: Uint8ClampedArray, w: number, h: number, dw: number, dh: number) =>
          chores.downsampleRgba(rgba, w, h, dw, dh)
      : undefined;
    const meta = {
      name: locationName || `Snapshot ${new Date().toLocaleString()}`,
      lat: position.lat(),
      lng: position.lng(),
      heading,
      pitch,
      zoom,
      locationName,
      panoId: panorama.getPano() || undefined,
      imageDate: currentImageDate ?? undefined,
      lookId: lookId ?? undefined,
      vehicleType,
    };

    if (!output) {
      addSnapshot({
        ...meta,
        dataUrl: renderer.getCanvasDataURL(),
        thumbnailDataUrl: undefined,
      });
      return;
    }

    // Free-look has no cabin canvas, and the one-frame compositor already put
    // the cabin in this canvas — either way skip the overlay wait so stills
    // stay immediate. Only the CSS-overlay cabin still needs the 2D latch.
    const needsLatch = viewMode === 'car' && needsCabinOverlayLatch(renderer);
    const overlay = needsLatch ? cabinOverlay : null;
    void captureCompositedStill(output, overlay, { timeoutMs: 400 }).then((still) => {
      addSnapshot({
        ...meta,
        dataUrl: still.dataUrl,
        thumbnailDataUrl: makePickerThumbDataUrl(still.canvas, downsample) ?? undefined,
      });
    });
  }, [
    panorama,
    renderer,
    addSnapshot,
    heading,
    pitch,
    zoom,
    locationName,
    currentImageDate,
    lookId,
    vehicleType,
    cabinOverlay,
    viewMode,
  ]);

  const handleSnapshotTeleport = useCallback(
    async (
      lat: number,
      lng: number,
      targetHeading: number,
      targetPitch: number,
      panoId?: string,
    ) => {
      if (panoId) {
        await teleportToPanoSafe(panoId);
      } else {
        await teleportSafe(lat, lng, targetHeading, targetPitch);
      }
      setHeading(targetHeading);
      setPitch(targetPitch);
    },
    [teleportToPanoSafe, teleportSafe, setHeading, setPitch],
  );

  return {
    cabinOverlay,
    handleTakeSnapshot,
    gallery: {
      snapshots: snapshots.snapshots,
      removeSnapshot: snapshots.removeSnapshot,
      updateSnapshotName: snapshots.updateSnapshotName,
      downloadSnapshot: snapshots.downloadSnapshot,
      clearAllSnapshots: snapshots.clearAllSnapshots,
      getSnapshotDeepLink: snapshots.getSnapshotDeepLink,
      shareSnapshot: snapshots.shareSnapshot,
      onTeleport: handleSnapshotTeleport,
      onTakeSnapshot: handleTakeSnapshot,
    },
  };
}
