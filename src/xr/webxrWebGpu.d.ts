/**
 * The WebXR/WebGPU Binding Module (https://immersive-web.github.io/webxr-webgpu-binding/),
 * which `@types/webxr` does not cover. Only what `xr/` uses, as the editor's
 * draft of Aug 2026 defines it; Chromium implements the projection-layer
 * subset (behind `chrome://flags/#webxr-webgpu-binding`), WebKit on visionOS
 * adds `getSubImage`. `GPURequestAdapterOptions.xrCompatible` is already in
 * `@webgpu/types`.
 */
interface XRGPUProjectionLayerInit {
    /** Chromium accepts `rgba8unorm` / `bgra8unorm` only. */
    colorFormat: GPUTextureFormat;
    depthStencilFormat?: GPUTextureFormat | null;
    textureUsage?: GPUTextureUsageFlags;
    scaleFactor?: number;
}

interface XRGPUSubImage extends XRSubImage {
    /** A 2D array texture, one layer per view; render through `getViewDescriptor()`. */
    readonly colorTexture: GPUTexture;
    readonly depthStencilTexture: GPUTexture | null;
    getViewDescriptor(): GPUTextureViewDescriptor;
}

declare class XRGPUBinding {
    constructor(session: XRSession, device: GPUDevice);
    readonly nativeProjectionScaleFactor: number;
    getPreferredColorFormat(): GPUTextureFormat;
    createProjectionLayer(init: XRGPUProjectionLayerInit): XRProjectionLayer;
    getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage;
}
