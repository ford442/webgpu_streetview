import type { UseSharedSessionResult } from '../hooks/useSharedSession';
import { getCabinView, setCabinView } from '../car/cabinView';
import { useGradeSettings, useLightingSettings, useWeatherSettings } from '../hooks/useEnvironmentSettings';
import type { VehicleType } from '../car/VehicleManager';
import { serializeWeatherPreset } from '../utils/weatherPresetSync';
import { useSharedSessionSync } from './useSharedSessionSync';

export interface SharedSessionSyncProps {
  sharedSession: UseSharedSessionResult;
  panorama: google.maps.StreetViewPanorama | null;
  viewMode: 'freelook' | 'car';
  vehicleType: VehicleType;
  /** Historical image date of the pano on screen — guests follow it via pano id. */
  imageDate: string | null;
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
 * The shared session's host/guest sync, mounted as a component.
 *
 * `useSharedSession` owns the WebRTC room (the shell calls it); this maps the
 * room's packets onto app state in both directions. It reads the weather and
 * look itself, so a slider drag or live-conditions tick re-renders this null
 * component, not the shell.
 */
export function SharedSessionSync(props: SharedSessionSyncProps): null {
  const weather = useWeatherSettings();
  const { timeOfDay, applyTimeOfDayPreset } = useLightingSettings();
  const { activeLookId, applyLookPack } = useGradeSettings();
  const weatherPreset = serializeWeatherPreset({
    timeOfDay,
    rainIntensity: weather.rainIntensity,
    snowIntensity: weather.snowIntensity,
    fogDensity: weather.fogDensity,
  });

  useSharedSessionSync({
    sharedSession: props.sharedSession,
    panorama: props.panorama,
    viewMode: props.viewMode,
    teleportToPanoSafe: props.teleportToPanoSafe,
    setHeading: props.setHeading,
    setPitch: props.setPitch,
    setZoom: props.setZoom,
    weatherPreset,
    applyTimeOfDayPreset,
    setRainIntensity: weather.setRainIntensity,
    setSnowIntensity: weather.setSnowIntensity,
    setFogDensity: weather.setFogDensity,
    lookId: activeLookId,
    imageDate: props.imageDate,
    vehicleType: props.vehicleType,
    cabinView: getCabinView(),
    hdr: props.hdr,
    applyLookPack,
    setVehicleType: props.setSessionVehicle,
    setViewMode: props.setViewMode,
    setCarHeading: props.setCarHeading,
    setCabinView,
  });

  return null;
}
