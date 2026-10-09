/** Shown on the banner and logged whenever the `?webgl2=1` fallback is live. */
export const WEBGL2_FALLBACK_ACTIVE_MESSAGE = 'WebGL2 fallback active — WebGPU not in use';

/** Shown when WebGPU fails and the fallback was not requested. */
export const WEBGPU_REQUIRED_MESSAGE =
    'WebGPU is required. Add ?webgl2=1 to the URL to use the WebGL2 fallback.';
