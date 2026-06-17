import { useCallback } from 'react';
import { getTimeOfDayForLocation, getColorPresetForTimeOfDay } from '../utils/geoTimeUtils';
import { getTopStationForLocation } from '../services/radioBrowserService';

export interface UseGlobeTeleportOptions {
  teleportSafe: (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => Promise<void>;
  applyTimeOfDayPreset: (mode: 'day' | 'sunrise' | 'sunset' | 'night') => void;
  applyColorGradingPreset: (preset: string) => void;
  globeMode: { deactivate: () => void };
  audioRef: React.RefObject<HTMLAudioElement | null>;
  setNavPending: (pending: boolean) => void;
  setIsRadioPlaying: (playing: boolean) => void;
}

export function useGlobeTeleport({
  teleportSafe,
  applyTimeOfDayPreset,
  applyColorGradingPreset,
  globeMode,
  audioRef,
  setNavPending,
  setIsRadioPlaying,
}: UseGlobeTeleportOptions) {
  return useCallback(async (lat: number, lng: number) => {
    setNavPending(true);
    try {
      await teleportSafe(lat, lng);
    } finally {
      setNavPending(false);
    }

    try {
      const timePreset = getTimeOfDayForLocation(lat, lng);
      applyTimeOfDayPreset(timePreset);
      const colorPreset = getColorPresetForTimeOfDay(timePreset);
      applyColorGradingPreset(colorPreset);
    } catch (err) {
      console.warn('[GlobeTeleport] Auto-lighting failed:', err);
    }

    getTopStationForLocation(lat, lng).then(station => {
      if (station && audioRef.current) {
        audioRef.current.src = station.urlResolved || station.url;
        audioRef.current.play().catch(() => {});
        setIsRadioPlaying(true);
        console.log(`[GlobeTeleport] Tuned to: ${station.name} (${station.country})`);
      }
    }).catch(err => {
      console.warn('[GlobeTeleport] Auto-radio failed:', err);
    });

    globeMode.deactivate();
  }, [teleportSafe, applyTimeOfDayPreset, applyColorGradingPreset, globeMode, audioRef, setNavPending, setIsRadioPlaying]);
}
