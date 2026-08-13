/**
 * Shared panel/action contracts between ConnectedChrome (desktop) and MobileUI.
 * Keeps toolbar toggles and stage actions aligned without duplicating prop shapes.
 */

import type { QualitySettings } from '../../hooks/useDeviceDetection';
import type { VehicleType } from '../../car/VehicleManager';

/** Core navigation + view-mode actions surfaced on both desktop toolbar and mobile chrome. */
export interface ChromeStageActions {
  onToggleCarMode: () => void;
  onToggleMap: () => void;
  onTakeSnapshot: () => void;
  onMove: (direction: 'forward' | 'backward' | 'left' | 'right') => void;
}

/** Environment / vehicle controls shared between mobile quick actions and car dashboard. */
export interface ChromeEnvironmentActions {
  onToggleWipers?: () => void;
  onToggleRoof?: () => void;
  onVehicleChange?: (vehicle: VehicleType) => void;
  onQualityChange?: (settings: QualitySettings) => void;
}

/** Read-only chrome state both surfaces can reflect. */
export interface ChromeStageState {
  isCarMode?: boolean;
  isMapOpen?: boolean;
  wipersEnabled?: boolean;
  isRoofOpen?: boolean;
  currentVehicle?: VehicleType;
  heading?: number;
  zoom?: number;
}

import type { UsePlaceSearchResult } from '../../hooks/usePlaceSearch';

/** Combined contract MobileUI consumes — mirrors ConnectedChrome session toggles. */
export interface MobileChromeContract extends ChromeStageActions, ChromeEnvironmentActions, ChromeStageState {
  isVisible: boolean;
  onPan: (deltaX: number, deltaY: number) => void;
  onZoom: (zoomDelta: number) => void;
  search?: UsePlaceSearchResult;
}
