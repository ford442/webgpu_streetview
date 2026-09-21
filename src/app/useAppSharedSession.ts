import { useSharedSession, type UseSharedSessionResult } from '../hooks/useSharedSession';
import { getCabinView, setCabinView } from '../car/cabinView';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { VehicleType } from '../car/VehicleManager';
import { useSharedSessionSync } from './useSharedSessionSync';

export interface UseAppSharedSessionOptions {
  env: EnvironmentSettingsState;
  panorama: google.maps.StreetViewPanorama | null;
  heading: number;
  pitch: number;
  zoom: number;
  viewMode: 'freelook' | 'car';
  carHeading: number;
  vehicleType: VehicleType;
  /** Historical image date of the pano on screen — guests follow it via pano id. */
  imageDate: string | null;
  /** Serialized weather preset the host broadcasts (see weatherPresetSync). */
  weatherPreset: string;
  hdr: boolean;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  setViewMode: (mode: 'freelook' | 'car') => void;
  setCarHeading: (heading: number) => void;
  setSessionVehicle: (type: VehicleType) => void;
}

/**
 * The shared session and its host/guest sync, as one unit.
 *
 * `useSharedSession` owns the WebRTC room; `useSharedSessionSync` maps the
 * room's packets onto app state in both directions. They are never useful
 * apart, and pairing them here keeps the twenty-odd state channels the sync
 * needs out of the shell body.
 */
export function useAppSharedSession(options: UseAppSharedSessionOptions): UseSharedSessionResult {
  const { env } = options;
  const sharedSession = useSharedSession();

  useSharedSessionSync({
    sharedSession,
    panorama: options.panorama,
    heading: options.heading,
    pitch: options.pitch,
    zoom: options.zoom,
    viewMode: options.viewMode,
    teleportToPanoSafe: options.teleportToPanoSafe,
    setHeading: options.setHeading,
    setPitch: options.setPitch,
    setZoom: options.setZoom,
    weatherPreset: options.weatherPreset,
    applyTimeOfDayPreset: env.applyTimeOfDayPreset,
    setRainIntensity: env.setRainIntensity,
    setSnowIntensity: env.setSnowIntensity,
    setFogDensity: env.setFogDensity,
    lookId: env.activeLookId,
    imageDate: options.imageDate,
    vehicleType: options.vehicleType,
    cabinView: getCabinView(),
    carHeading: options.carHeading,
    hdr: options.hdr,
    applyLookPack: env.applyLookPack,
    setVehicleType: options.setSessionVehicle,
    setViewMode: options.setViewMode,
    setCarHeading: options.setCarHeading,
    setCabinView,
  });

  return sharedSession;
}
