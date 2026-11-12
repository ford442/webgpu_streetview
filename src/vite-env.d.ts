/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare global {
  interface ImportMetaEnv {
    readonly BASE_URL: string;
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    /** Build-time config: always set (maybe ''), from `scripts/public-env-keys.json` via vite.config.ts. */
    readonly VITE_PUBLIC_MAPS_API_KEY: string;
    readonly VITE_PUBLIC_GOOGLE_MAPS_MAP_ID: string;
    readonly VITE_PUBLIC_STORAGE_API_URL: string;
    readonly VITE_PUBLIC_ENABLE_SW: string;
    readonly VITE_PUBLIC_SUPABASE_URL: string;
    readonly VITE_PUBLIC_SUPABASE_ANON_KEY: string;
    readonly VITE_PUBLIC_TURN_URL: string;
    readonly VITE_PUBLIC_TURN_USERNAME: string;
    readonly VITE_PUBLIC_TURN_CREDENTIAL: string;
    readonly VITE_PUBLIC_BUILD_VERSION: string;
    readonly VITE_PUBLIC_BUILD_TIME: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  /** Config and backend flags. Each debug / probe global is typed by the module that publishes it; `window.__SV__` (`app/svGlobals.ts`) reads them. */
  interface Window {
    MAPS_API_KEY?: string;
    CESIUM_ION_TOKEN?: string;
    /** OSRM-compatible route endpoint (config.js); unset = public demo, '' = off. */
    ROUTING_ENDPOINT?: string;
  }
}

export {};
