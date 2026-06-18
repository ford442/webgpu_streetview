import { Renderer } from './Renderer';
import { WebGLFallbackRenderer } from './WebGLFallbackRenderer';
import {
    exposeRendererDebugGlobals,
    getRendererDebugOptions,
    getRendererPreference,
    RendererBackendType,
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
} from './RendererBackend';

export interface RendererCreateResult {
    renderer: StreetViewRenderer | null;
    backendType: RendererBackendType | null;
    fallbackReason?: string;
    debugOptions: RendererDebugOptions;
}

export async function createStreetViewRenderer(
    canvas: HTMLCanvasElement,
    options?: RendererInitOptions
): Promise<RendererCreateResult> {
    const preference = getRendererPreference();
    const debugOptions = getRendererDebugOptions();
    const attempts: RendererBackendType[] = preference === 'webgl'
        ? ['webgl', 'webgpu']
        : preference === 'webgpu'
            ? ['webgpu', 'webgl']
            : ['webgpu', 'webgl'];

    let fallbackReason: string | undefined;

    for (const backend of attempts) {
        const renderer = backend === 'webgpu'
            ? new Renderer(canvas)
            : new WebGLFallbackRenderer(canvas, debugOptions, fallbackReason || 'WebGPU unavailable or disabled');

        const success = await renderer.init(options);
        if (success) {
            exposeRendererDebugGlobals(
                backend,
                backend === 'webgl' ? renderer.fallbackReason || fallbackReason : undefined,
                debugOptions,
                (nextDebugOptions) => {
                    Object.assign(debugOptions, nextDebugOptions);
                    renderer.setDebugOptions?.(debugOptions);
                }
            );
            renderer.setDebugOptions?.(debugOptions);
            return {
                renderer,
                backendType: backend,
                fallbackReason: backend === 'webgl' ? renderer.fallbackReason || fallbackReason : undefined,
                debugOptions,
            };
        }

        renderer.destroy();
        if (backend === 'webgpu') {
            fallbackReason = preference === 'webgpu'
                ? 'Requested WebGPU renderer failed to initialize'
                : 'WebGPU renderer failed to initialize';
        } else {
            fallbackReason = 'WebGL2 renderer failed to initialize';
        }
    }

    return {
        renderer: null,
        backendType: null,
        fallbackReason,
        debugOptions,
    };
}
