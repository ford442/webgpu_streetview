/// <reference types="react-scripts" />
/// <reference types="@webgpu/types" />

import type { RendererBackendPreference, RendererEffectIsolation } from './renderer/RendererBackend';

declare global {
  interface Window {
    rendererType?: 'webgpu' | 'webgl';
    usingWebGPU?: boolean;
    usingWebGL?: boolean;
    rendererFallbackReason?: string;
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
    };
  }
}

export {};
