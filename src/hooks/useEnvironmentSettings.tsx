import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  toggleWipers,
  setCarWipers,
  toggleCarHeadlights,
  toggleCarDomeLight,
  getCarDomeLightState,
} from '../car';

// Types
export type TimeOfDay = 'day' | 'sunset' | 'night';

export interface EnvironmentSettingsState {
  // Weather settings
  rainIntensity: number;
  setRainIntensity: (value: number) => void;
  snowIntensity: number;
  setSnowIntensity: (value: number) => void;
  wind: number;
  setWind: (value: number) => void;
  
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
  toggleHeadlights: () => void;
  setHeadlights: (enabled: boolean) => void;
  
  highBeam: boolean;
  toggleHighBeam: () => void;
  setHighBeam: (enabled: boolean) => void;
  
  domeLightOn: boolean;
  toggleDomeLight: () => void;
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

export const EnvironmentSettingsProvider: React.FC<EnvironmentSettingsProviderProps> = ({
  children,
}) => {
  // Weather state
  const [rainIntensity, setRainIntensity] = useState(0);
  const [snowIntensity, setSnowIntensity] = useState(0);
  const [wind, setWind] = useState(0);
  
  // Time of day
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [autoNightMode, setAutoNightMode] = useState(true);
  
  // Night/astronomical
  const [nightIntensity, setNightIntensity] = useState(0.0);
  const [sunAzimuth, setSunAzimuth] = useState(0.0);
  const [sunAltitude, setSunAltitude] = useState(0.2);
  const [moonAzimuth, setMoonAzimuth] = useState(0.0);
  const [moonAltitude, setMoonAltitude] = useState(-0.5);
  const [moonIntensity, setMoonIntensity] = useState(0.0);
  
  // Car state
  const [wipersEnabled, setWipersEnabledState] = useState(false);
  const [headlightsOn, setHeadlightsOnState] = useState(false);
  const [highBeam, setHighBeamState] = useState(false);
  const [domeLightOn, setDomeLightOnState] = useState(false);
  const [isRoofOpen, setIsRoofOpen] = useState(false);
  
  // Color grading
  const [vibrance, setVibrance] = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [exposure, setExposure] = useState(0.0);
  const [temperature, setTemperature] = useState(0.0);
  const [tint, setTint] = useState(0.0);
  const [shaderEffectsEnabled, setShaderEffectsEnabled] = useState(true);
  
  // Wipers
  const toggleWipersCallback = useCallback(() => {
    const newState = toggleWipers();
    setWipersEnabledState(newState);
    setCarWipers(newState);
  }, []);
  
  const setWipers = useCallback((enabled: boolean) => {
    setWipersEnabledState(enabled);
    setCarWipers(enabled);
  }, []);
  
  // Headlights
  const toggleHeadlights = useCallback(() => {
    const newState = toggleCarHeadlights();
    setHeadlightsOnState(newState);
  }, []);
  
  const setHeadlights = useCallback((enabled: boolean) => {
    setHeadlightsOnState(enabled);
  }, []);
  
  // High beam
  const toggleHighBeamCallback = useCallback(() => {
    setHighBeamState(prev => !prev);
  }, []);
  
  // Dome light
  const toggleDomeLightCallback = useCallback(() => {
    const newState = toggleCarDomeLight();
    setDomeLightOnState(newState);
  }, []);
  
  const setDomeLight = useCallback((enabled: boolean) => {
    setDomeLightOnState(enabled);
  }, []);
  
  // Roof
  const toggleRoofCallback = useCallback(() => {
    setIsRoofOpen(prev => !prev);
  }, []);
  
  // Apply time of day preset
  const applyTimeOfDayPreset = useCallback((preset: TimeOfDay) => {
    setAutoNightMode(false);
    setTimeOfDay(preset);
    
    switch (preset) {
      case 'day':
        setNightIntensity(0.0);
        setSunAltitude(0.785);
        setSunAzimuth(0);
        setMoonAltitude(-0.5);
        break;
      case 'sunset':
        setNightIntensity(0.3);
        setSunAltitude(-0.052);
        setSunAzimuth(-1.57);
        setMoonAltitude(0.2);
        setMoonAzimuth(1.57);
        break;
      case 'night':
        setNightIntensity(1.0);
        setHeadlightsOnState(true);
        setSunAltitude(-1.047);
        setSunAzimuth(0);
        setMoonAltitude(0.5);
        setMoonAzimuth(0.785);
        break;
    }
  }, []);
  
  // Apply color grading preset
  const applyColorGradingPreset = useCallback((preset: string) => {
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
  
  const value: EnvironmentSettingsState = {
    // Weather
    rainIntensity,
    setRainIntensity,
    snowIntensity,
    setSnowIntensity,
    wind,
    setWind,
    
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
    setRoofOpen,
    
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
  };
  
  return (
    <EnvironmentSettingsContext.Provider value={value}>
      {children}
    </EnvironmentSettingsContext.Provider>
  );
};

export default EnvironmentSettingsContext;
