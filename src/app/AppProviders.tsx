import { AutoNightDriver } from './AutoNightDriver';
import { StreetViewProvider, ViewModeProvider, EnvironmentSettingsProvider } from '../hooks';

export interface AppProvidersProps {
  children: React.ReactNode;
}

/** Root provider stack for Street View, view mode, and environment settings. */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <StreetViewProvider>
      <ViewModeProvider>
        <EnvironmentSettingsProvider>
          <AutoNightDriver />
          {children}
        </EnvironmentSettingsProvider>
      </ViewModeProvider>
    </StreetViewProvider>
  );
}
