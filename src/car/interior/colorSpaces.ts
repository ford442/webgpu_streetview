import * as THREE from 'three';
import { DisplayP3ColorSpace, DisplayP3ColorSpaceImpl } from 'three/examples/jsm/math/ColorSpaces.js';

/**
 * three 0.180 defines only sRGB / linear-sRGB; `display-p3` lives in
 * `examples/jsm/math/ColorSpaces.js` and must be registered before a renderer
 * is built with `outputColorSpace = 'display-p3'` (`?p3`), else the tone
 * mapping / output lookup reads an undefined entry and `init()` throws.
 * Idempotent: safe to call from every renderer factory.
 */
export function ensureDisplayP3Registered(): void {
    if (THREE.ColorManagement.spaces[DisplayP3ColorSpace]) return;
    THREE.ColorManagement.define({ [DisplayP3ColorSpace]: DisplayP3ColorSpaceImpl });
}

export const CABIN_DISPLAY_P3 = DisplayP3ColorSpace as THREE.ColorSpace;
