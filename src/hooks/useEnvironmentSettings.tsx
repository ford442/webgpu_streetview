import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { loadCarRuntime } from '../car/carRuntimeLoader';
import {
  getLookPack,
  lookPackToEnvPatch,
  type LookEnvPatch,
  type LookId,
} from '../config/lookPacks';
import { readBootLook } from '../utils/lookLink';

// Types
export type TimeOfDay = 'day' | 'sunrise' | 'sunset' | 'night';
export type { LookId };

export interface EnvironmentSettingsState {
  // Weather settings
  rainIntensity: number;
  setRainIntensity: (value: number) => void;
  snowIntensity: number;
  setSnowIntensity: (value: number) => void;
  wind: number;
  setWind: (value: number) => void;
  fogDensity: number;
  setFogDensity: (value: number) => void;
  
  // Time of day
  timeOfDay: TimeOfDay;
  setTimeOfDay: (time: TimeOfDay) => void;
  autoNightMode: boolean;
  setAutoNightMode: (enabled: boolean) => void;
  
  // Night/astronomical
  nightIntensity: number;
  setNightIntensity: (value: number) => void;
  sunAzimuth: number;
  setSunAzimuth: (value: number) => void;
  sunAltitude: number;
  setSunAltitude: (value: number) => void;
  moonAzimuth: number;
  setMoonAzimuth: (value: number) => void;
  moonAltitude: number;
  setMoonAltitude: (value: number) => void;
  moonIntensity: number;
  setMoonIntensity: (value: number) => void;
  
  // Car settings
  wipersEnabled: boolean;
  toggleWipers: () => void;
  setWipers: (enabled: boolean) => void;
  
  headlightsOn: boolean;
  toggleHeadlights: () => boolean;
  setHeadlights: (enabled: boolean) => void;
  
  highBeam: boolean;
  toggleHighBeam: () => void;
  setHighBeam: (enabled: boolean) => void;
  
  domeLightOn: boolean;
  toggleDomeLight: () => boolean;
  setDomeLight: (enabled: boolean) => void;
  
  isRoofOpen: boolean;
  toggleRoof: () => void;
  setRoofOpen: (open: boolean) => void;
  
  // Color grading
  vibrance: number;
  setVibrance: (value: number) => void;
  saturation: number;
  setSaturation: (value: number) => void;
  contrast: number;
  setContrast: (value: number) => void;
  exposure: number;
  setExposure: (value: number) => void;
  temperature: number;
  setTemperature: (value: number) => void;
  tint: number;
  setTint: (value: number) => void;
  shaderEffectsEnabled: boolean;
  setShaderEffectsEnabled: (enabled: boolean) => void;
  
  // Presets
  applyTimeOfDayPreset: (preset: TimeOfDay) => void;
  applyColorGradingPreset: (preset: string) => void;
  /** Last applied named look (`?look=`). Null when the user is on a custom grade. */
  activeLookId: LookId | null;
  applyLookPack: (id: string) => void;

  // Derived
  /** CSS rgba string for the current ambient light color — used to tint dashboard glass panels. */
  ambientLightColor: string;
}

const EnvironmentSettingsContext = createContext<EnvironmentSettingsState | null>(null);

export const useEnvironmentSettings = () => {
  const context = useContext(EnvironmentSettingsContext);
  if (!context) {
    throw new Error('useEnvironmentSettings must be used within EnvironmentSettingsProvider');
  }
  return context;
};

interface EnvironmentSettingsProviderProps {
  children: React.ReactNode;
}

const TOD_ASTRONOMY: Record<TimeOfDay, {
  nightIntensity: number;
  sunAltitude: number;
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
}> = {
  day: { nightIntensity: 0.0, sunAltitude: 0.785, sunAzimuth: 0, moonAltitude: -0.5, moonAzimuth: 0 },
  sunrise: { nightIntensity: 0.1, sunAltitude: 0.052, sunAzimuth: 0, moonAltitude: -0.5, moonAzimuth: -1.57 },
  sunset: { nightIntensity: 0.3, sunAltitude: -0.052, sunAzimuth: -1.57, moonAltitude: 0.2, moonAzimuth: 1.57 },
  night: { nightIntensity: 1.0, sunAltitude: -1.047, sunAzimuth: 0, moonAltitude: 0.5, moonAzimuth: 0.785 },
};

function snapshotBoot() {
  return readBootLook();
}

export const EnvironmentSettingsProvider: React.FC<EnvironmentSettingsProviderProps> = ({
  children,
}) => {
  const boot = snapshotBoot();
  const bootPatch = boot?.patch;
  const bootAstro = TOD_ASTRONOMY[bootPatch?.timeOfDay ?? 'day'];

  // Weather state
  const [rainIntensity, setRainIntensity] = useState(bootPatch?.rainIntensity ?? 0);
  const [snowIntensity, setSnowIntensity] = useState(bootPatch?.snowIntensity ?? 0);
  const [wind, setWind] = useState(bootPatch?.wind ?? 0);
  const [fogDensity, setFogDensity] = useState(bootPatch?.fogDensity ?? 0.0);
  
  // Time of day
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(bootPatch?.timeOfDay ?? 'day');
  const [autoNightMode, setAutoNightMode] = useState(bootPatch ? false : true);
  
  // Night/astronomical
  const [nightIntensity, setNightIntensity] = useState(
    bootPatch?.nightIntensity ?? bootAstro.nightIntensity,
  );
  const [sunAzimuth, setSunAzimuth] = useState(bootAstro.sunAzimuth);
  const [sunAltitude, setSunAltitude] = useState(bootAstro.sunAltitude);
  const [moonAzimuth, setMoonAzimuth] = useState(bootAstro.moonAzimuth);
  const [moonAltitude, setMoonAltitude] = useState(bootAstro.moonAltitude);
  const [moonIntensity, setMoonIntensity] = useState(0.0);
  
  // Car state
  const [wipersEnabled, setWipersEnabledState] = useState(bootPatch?.wipersEnabled ?? false);
  const [headlightsOn, setHeadlightsOnState] = useState(bootPatch?.headlightsOn ?? false);
  const [highBeam, setHighBeamState] = useState(bootPatch?.highBeam ?? false);
  const [domeLightOn, setDomeLightOnState] = useState(bootPatch?.domeLightOn ?? false);
  const [isRoofOpen, setIsRoofOpen] = useState(false);
  
  // Color grading
  const [vibrance, setVibrance] = useState(bootPatch?.vibrance ?? 1.0);
  const [saturation, setSaturation] = useState(bootPatch?.saturation ?? 1.0);
  const [contrast, setContrast] = useState(bootPatch?.contrast ?? 1.0);
  const [exposure, setExposure] = useState(bootPatch?.exposure ?? 0.0);
  const [temperature, setTemperature] = useState(bootPatch?.temperature ?? 0.0);
  const [tint, setTint] = useState(bootPatch?.tint ?? 0.0);
  const [shaderEffectsEnabled, setShaderEffectsEnabled] = useState(
    bootPatch?.shaderEffectsEnabled ?? true,
  );
  const [activeLookId, setActiveLookId] = useState<LookId | null>(boot?.lookId ?? null);
  
  // Wipers
  const toggleWipersCallback = useCallback(() => {
    void loadCarRuntime().then(({ toggleWipers, setCarWipers }) => {
      const newState = toggleWipers();
      setWipersEnabledState(newState);
      setCarWipers(newState);
    });
  }, []);

  const setWipers = useCallback((enabled: boolean) => {
    setWipersEnabledState(enabled);
    void loadCarRuntime().then(({ setCarWipers }) => setCarWipers(enabled));
  }, []);

  // Headlights
  const toggleHeadlights = useCallback((): boolean => {
    const newState = !headlightsOn;
    setHeadlightsOnState(newState);
    void loadCarRuntime().then(({ setCarHeadlights }) => setCarHeadlights(newState));
    return newState;
  }, [headlightsOn]);

  const setHeadlights = useCallback((enabled: boolean) => {
    setHeadlightsOnState(enabled);
    void loadCarRuntime().then(({ setCarHeadlights }) => setCarHeadlights(enabled));
  }, []);
  
  // High beam
  const toggleHighBeamCallback = useCallback(() => {
    setHighBeamState(prev => !prev);
  }, []);
  
  // Dome light
  const toggleDomeLightCallback = useCallback((): boolean => {
    const newState = !domeLightOn;
    setDomeLightOnState(newState);
    void loadCarRuntime().then(({ setCarDomeLight }) => setCarDomeLight(newState));
    return newState;
  }, [domeLightOn]);

  const setDomeLight = useCallback((enabled: boolean) => {
    setDomeLightOnState(enabled);
    void loadCarRuntime().then(({ setCarDomeLight }) => setCarDomeLight(enabled));
  }, []);
  
  // Roof
  const toggleRoofCallback = useCallback(() => {
    setIsRoofOpen(prev => !prev);
  }, []);
  
  // Apply time of day preset
  const applyTimeOfDayPreset = useCallback((preset: TimeOfDay) => {
    setAutoNightMode(false);
    setTimeOfDay(preset);
    const astro = TOD_ASTRONOMY[preset];
    setNightIntensity(astro.nightIntensity);
    setSunAltitude(astro.sunAltitude);
    setSunAzimuth(astro.sunAzimuth);
    setMoonAltitude(astro.moonAltitude);
    setMoonAzimuth(astro.moonAzimuth);
    if (preset === 'night') {
      setHeadlightsOnState(true);
    }
  }, []);

  const applyLookPatch = useCallback((patch: LookEnvPatch) => {
    setAutoNightMode(false);
    setShaderEffectsEnabled(true);
    setTimeOfDay(patch.timeOfDay);
    setRainIntensity(patch.rainIntensity);
    setSnowIntensity(patch.snowIntensity);
    setWind(patch.wind);
    setFogDensity(patch.fogDensity);
    setVibrance(patch.vibrance);
    setSaturation(patch.saturation);
    setContrast(patch.contrast);
    setExposure(patch.exposure);
    setTemperature(patch.temperature);
    setTint(patch.tint);
    setNightIntensity(patch.nightIntensity);
    const astro = TOD_ASTRONOMY[patch.timeOfDay];
    setSunAltitude(astro.sunAltitude);
    setSunAzimuth(astro.sunAzimuth);
    setMoonAltitude(astro.moonAltitude);
    setMoonAzimuth(astro.moonAzimuth);
    setHeadlightsOnState(patch.headlightsOn);
    setHighBeamState(patch.highBeam);
    setDomeLightOnState(patch.domeLightOn);
    setWipersEnabledState(patch.wipersEnabled);
    void loadCarRuntime().then(({ setCarHeadlights, setCarDomeLight, setCarWipers }) => {
      setCarHeadlights(patch.headlightsOn);
      setCarDomeLight(patch.domeLightOn);
      setCarWipers(patch.wipersEnabled);
    });
  }, []);

  const applyLookPack = useCallback((id: string) => {
    const pack = getLookPack(id);
    if (!pack) return;
    applyLookPatch(lookPackToEnvPatch(pack));
    setActiveLookId(pack.id);
  }, [applyLookPatch]);
  
  // Apply color grading preset
  const applyColorGradingPreset = useCallback((preset: string) => {
    setActiveLookId(null);
    switch (preset) {
      case 'none':
        setShaderEffectsEnabled(false);
        break;
      case 'daylight':
        setShaderEffectsEnabled(true);
        setVibrance(1.0);
        setSaturation(1.0);
        setContrast(1.0);
        setExposure(0.0);
        setTemperature(0.0);
        setTint(0.0);
        setNightIntensity(0.0);
        break;
      case 'golden':
        setShaderEffectsEnabled(true);
        setVibrance(1.2);
        setSaturation(1.1);
        setContrast(1.1);
        setExposure(0.1);
        setTemperature(0.3);
        setTint(-0.1);
        break;
      case 'sunset':
        setShaderEffectsEnabled(true);
        setVibrance(1.3);
        setSaturation(1.2);
        setContrast(1.2);
        setExposure(0.2);
        setTemperature(0.5);
        setTint(-0.2);
        break;
      case 'overcast':
        setShaderEffectsEnabled(true);
        setVibrance(0.8);
        setSaturation(0.9);
        setContrast(1.1);
        setExposure(-0.1);
        setTemperature(-0.2);
        setTint(0.1);
        break;
      case 'rain':
        setShaderEffectsEnabled(true);
        setVibrance(0.7);
        setSaturation(0.8);
        setContrast(1.3);
        setExposure(-0.2);
        setTemperature(-0.3);
        setTint(0.2);
        break;
      case 'night':
        setShaderEffectsEnabled(true);
        setVibrance(0.6);
        setSaturation(0.7);
        setContrast(1.4);
        setExposure(-0.5);
        setTemperature(-0.4);
        setTint(0.3);
        setNightIntensity(1.0);
        setHeadlightsOnState(true);
        break;
      case 'snow':
        setShaderEffectsEnabled(true);
        setVibrance(1.1);
        setSaturation(0.9);
        setContrast(1.2);
        setExposure(0.3);
        setTemperature(-0.1);
        setTint(0.0);
        break;
    }
  }, []);
  
  // Compute ambient light color for dashboard tinting based on time of day
  const ambientLightColor = useMemo(() => {
    switch (timeOfDay) {
      case 'sunset':
        return `rgba(255, 120, 40, ${(0.1 + nightIntensity * 0.1).toFixed(3)})`;
      case 'sunrise':
        return 'rgba(255, 160, 80, 0.08)';
      case 'night':
        return `rgba(70, 210, 130, ${(nightIntensity * 0.18).toFixed(3)})`;
      default:
        return 'rgba(255, 255, 255, 0.0)';
    }
  }, [timeOfDay, nightIntensity]);

  const value: EnvironmentSettingsState = {
    // Weather
    rainIntensity,
    setRainIntensity,
    snowIntensity,
    setSnowIntensity,
    wind,
    setWind,
    fogDensity,
    setFogDensity,
    
    // Time
    timeOfDay,
    setTimeOfDay,
    autoNightMode,
    setAutoNightMode,
    
    // Night
    nightIntensity,
    setNightIntensity,
    sunAzimuth,
    setSunAzimuth,
    sunAltitude,
    setSunAltitude,
    moonAzimuth,
    setMoonAzimuth,
    moonAltitude,
    setMoonAltitude,
    moonIntensity,
    setMoonIntensity,
    
    // Car
    wipersEnabled,
    toggleWipers: toggleWipersCallback,
    setWipers,
    headlightsOn,
    toggleHeadlights,
    setHeadlights,
    highBeam,
    toggleHighBeam: toggleHighBeamCallback,
    setHighBeam: setHighBeamState,
    domeLightOn,
    toggleDomeLight: toggleDomeLightCallback,
    setDomeLight,
    isRoofOpen,
    toggleRoof: toggleRoofCallback,
    setRoofOpen: setIsRoofOpen,
    
    // Color grading
    vibrance,
    setVibrance,
    saturation,
    setSaturation,
    contrast,
    setContrast,
    exposure,
    setExposure,
    temperature,
    setTemperature,
    tint,
    setTint,
    shaderEffectsEnabled,
    setShaderEffectsEnabled,
    
    // Presets
    applyTimeOfDayPreset,
    applyColorGradingPreset,
    activeLookId,
    applyLookPack,

    // Derived
    ambientLightColor,
  };
  
  return (
    <EnvironmentSettingsContext.Provider value={value}>
      {children}
    </EnvironmentSettingsContext.Provider>
  );
};

export default EnvironmentSettingsContext;
