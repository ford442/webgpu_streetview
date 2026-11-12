export type RenderMode = 
  'streetview';

export type RendererBackendType = 'webgpu' | 'webgl';


export type RendererBackendPreference = RendererBackendType | 'auto';


export type RendererEffectIsolation =
    'all' |
    'raw' |
    'color' |
    'weather' |
    'fog' |
    'night' |
    'lighting';


export type WeatherPostProcessMode = 'fragment' | 'compute';


export type AdapterFeatureLevel = 'core' | 'compatibility';

declare global {
    interface Window {
        /** Which backend the page is running: set by `createStreetViewRenderer`, read by the chip, e2e and `__SV__`. */
        rendererType?: RendererBackendType | undefined;
        usingWebGPU?: boolean | undefined;
        usingWebGL?: boolean | undefined;
        rendererFallbackReason?: string | undefined;
        weatherPostProcessMode?: WeatherPostProcessMode | undefined;
    }
}
