import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { buildAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { GlobeModeControls } from '../hooks/useGlobeMode';
import { usePanelsSnapshot } from './useAppPanels';

export interface UseAppShortcutsOptions {
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
  announce: (msg: string) => void;
  /** Shortcuts are armed only once the app is live and not in cinema mode. */
  enabled: boolean;
}

/**
 * Arms the global keyboard shortcut bag.
 *
 * `buildAppKeyboardShortcuts` stays the SSOT for what each key does; this hook
 * exists so the shell hands over whole state bags (`env`, `globeMode`) instead
 * of re-listing forty individual props every time a shortcut is added. Panel
 * state comes from `panelsStore`, so the shell mounts it as `<AppShortcuts>`:
 * a panel toggle re-renders that null component, not the shell.
 */
function useAppShortcuts(options: UseAppShortcutsOptions): void {
  const panels = usePanelsSnapshot();
  const {
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

/** `useAppShortcuts` as a component, so its panel subscription stays out of the shell. */
export function AppShortcuts(props: UseAppShortcutsOptions): null {
  useAppShortcuts(props);
  return null;
}
