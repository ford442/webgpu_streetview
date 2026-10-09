import { useThrottledPov } from '../../state/povStore';
import CinemaOverlay from '../../components/CinemaOverlay';
import type { ClipOverlaySource } from '../../utils/canvasRecorder';
import { buildStudioShareUrl } from '../../utils/studioLink';
import type { useCinemaMode } from '../../hooks/useCinemaMode';
import type { StreetViewRenderer } from '../../renderer/RendererBackend';
import type { LookId } from '../../config/lookPacks';
import type { VehicleType } from '../../car/VehicleManager';

interface CinemaLayerProps {
  cinema: ReturnType<typeof useCinemaMode>;
  renderer: StreetViewRenderer | null;
  panorama: google.maps.StreetViewPanorama | null;
  lookId: LookId | null;
  vehicleType: VehicleType;
  imageDate: string | null;
  cabinOverlay: ClipOverlaySource;
  onTakeSnapshot: () => void;
}

/**
 * Cinema mode chrome: the letterboxed recording overlay plus the studio share
 * link for the frame currently on screen.
 *
 * Renders nothing unless cinema mode is on — the caller gates on `isConnected`
 * only, so the mode check lives here next to the state it reads.
 */
export function CinemaLayer({
  cinema,
  renderer,
  panorama,
  lookId,
  vehicleType,
  imageDate,
  cabinOverlay,
  onTakeSnapshot,
}: CinemaLayerProps) {
  const { isCinemaMode, letterbox, gradingLocked, exitCinemaMode, setLetterbox, setGradingLocked } =
    cinema;
  // The studio link tracks the frame on screen. POV lives outside React state, so
  // subscribe here (5 Hz is plenty for a share URL) instead of re-rendering the shell.
  const { heading, pitch, zoom } = useThrottledPov((p) => p, 5);
  if (!isCinemaMode) return null;

  const position = panorama?.getPosition();
  const shareUrl = position
    ? buildStudioShareUrl({
        lat: position.lat(),
        lng: position.lng(),
        heading,
        pitch,
        zoom,
        panoId: panorama?.getPano() || undefined,
        lookId,
        year: imageDate,
        vehicleType,
      })
    : undefined;

  return (
    <CinemaOverlay
      visible={isCinemaMode}
      letterbox={letterbox}
      onToggleLetterbox={() => setLetterbox(!letterbox)}
      gradingLocked={gradingLocked}
      onToggleGradingLock={() => setGradingLocked(!gradingLocked)}
      renderer={renderer}
      onExit={exitCinemaMode}
      onTakeSnapshot={onTakeSnapshot}
      cabinOverlay={cabinOverlay}
      lookId={lookId}
      vehicleType={vehicleType}
      panoId={panorama?.getPano() ?? null}
      imageDate={imageDate}
      shareUrl={shareUrl}
    />
  );
}
