/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@webgpu/types" />

import type {
  RendererBackendPreference,
  RendererEffectIsolation,
  WeatherPostProcessMode,
} from './renderer/RendererBackend';

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_MAPS_API_KEY?: string;
  readonly REACT_APP_MAPS_API_KEY?: string;
  readonly REACT_APP_GOOGLE_MAPS_MAP_ID?: string;
  readonly REACT_APP_STORAGE_API_URL?: string;
  readonly REACT_APP_CESIUM_ION_TOKEN?: string;
  readonly REACT_APP_ENABLE_SW?: string;
  readonly REACT_APP_BUILD_VERSION?: string;
  readonly REACT_APP_BUILD_TIME?: string;
  readonly VITE_BUILD_VERSION?: string;
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    MAPS_API_KEY?: string;
    CESIUM_ION_TOKEN?: string;
    rendererType?: 'webgpu' | 'webgl';
    usingWebGPU?: boolean;
    usingWebGL?: boolean;
    rendererFallbackReason?: string;
    weatherPostProcessMode?: WeatherPostProcessMode;
    rendererAdapterInfo?: import('./renderer/deviceCapabilities').AdapterCapabilitySummary;
    streetViewRendererDebug?: {
      getBackend: () => {
        rendererType?: 'webgpu' | 'webgl';
        usingWebGPU?: boolean;
        usingWebGL?: boolean;
        rendererFallbackReason?: string;
      };
      setBackend: (backend: RendererBackendPreference) => void;
      setEffectIsolation: (effect: RendererEffectIsolation) => void;
      setWireframe: (enabled: boolean) => void;
      getDebugOptions: () => {
        effectIsolation: RendererEffectIsolation;
        wireframe: boolean;
      };
      getWeatherMode: () => WeatherPostProcessMode;
      setWeatherMode: (mode: WeatherPostProcessMode) => void;
    };
  }

  // Jest-compat alias installed in setupTests for CRA-era tests.
  // eslint-disable-next-line no-var
  var jest: typeof import('vitest').vi;
}

export {};
