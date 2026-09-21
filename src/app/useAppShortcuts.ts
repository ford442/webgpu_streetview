import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { buildAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { GlobeModeControls } from '../hooks/useGlobeMode';
import type { AppPanels } from './useAppPanels';

export interface UseAppShortcutsOptions {
  /** Panel open/close bag — a superset of the panels the shortcuts drive. */
  panels: AppPanels;
  env: EnvironmentSettingsState;
  globeMode: GlobeModeControls;
  viewMode: 'freelook' | 'car';
  toggleViewMode: () => void;
  isCruiseMode: boolean;
  setIsCruiseMode: (v: boolean) => void;
  isCinemaMode: boolean;
  toggleCinemaMode: () => void;
  exitCinemaMode: () => void;
  isRadioPlaying: boolean;
  toggleRadio: () => void;
  showPerformanceStats: boolean;
  setShowPerformanceStats: (v: boolean) => void;
  announce: (msg: string) => void;
  /** Shortcuts are armed only once the app is live and not in cinema mode. */
  enabled: boolean;
}

/**
 * Arms the global keyboard shortcut bag.
 *
 * `buildAppKeyboardShortcuts` stays the SSOT for what each key does; this hook
 * exists so the shell hands over whole state bags (`panels`, `env`,
 * `globeMode`) instead of re-listing forty individual props every time a
 * shortcut is added.
 */
export function useAppShortcuts(options: UseAppShortcutsOptions): void {
  const {
    panels,
    env,
    globeMode,
    viewMode,
    toggleViewMode,
    isCruiseMode,
    setIsCruiseMode,
    isCinemaMode,
    toggleCinemaMode,
    exitCinemaMode,
    isRadioPlaying,
    toggleRadio,
    showPerformanceStats,
    setShowPerformanceStats,
    announce,
    enabled,
  } = options;

  useKeyboardShortcuts(
    buildAppKeyboardShortcuts({
      ...panels,
      timeOfDay: env.timeOfDay,
      applyTimeOfDayPreset: env.applyTimeOfDayPreset,
      wipersEnabled: env.wipersEnabled,
      toggleWipers: env.toggleWipers,
      headlightsOn: env.headlightsOn,
      toggleHeadlights: env.toggleHeadlights,
      toggleDomeLight: env.toggleDomeLight,
      isRoofOpen: env.isRoofOpen,
      toggleRoof: env.toggleRoof,
      showPerformanceStats,
      setShowPerformanceStats,
      isRadioPlaying,
      toggleRadio,
      isCinemaMode,
      toggleCinemaMode,
      exitCinemaMode,
      viewMode,
      toggleViewMode,
      isCruiseMode,
      setIsCruiseMode,
      globeMode,
      announce,
    }),
    enabled,
  );
}
