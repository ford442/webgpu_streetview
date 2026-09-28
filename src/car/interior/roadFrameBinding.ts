import * as THREE from 'three';
import type { RoadHdrFrame } from '../../renderer/roadFrameRegistry';

/**
 * Binds the road renderer's HDR intermediate into the cabin's TSL graph.
 *
 * The intermediate is a `GPUTexture` **owned by `TextureLifecycle`** on the
 * Street View side of the shared device. The cabin's `WebGPURenderer` reads it
 * through `THREE.ExternalTexture`, three's public "texture created externally
 * with the same renderer context" wrapper. Two properties of three's WebGPU
 * backend make a naive wrapper dangerous, and this module exists to neutralise
 * them:
 *
 * 1. **`dispose()` destroys the wrapped texture.** three tears an external
 *    texture down with the same `texture.destroy()` it uses for textures it
 *    allocated (`WebGPUTextureUtils.destroyTexture`). Disposing the wrapper — or
 *    the cabin renderer, which disposes every texture it tracked — would destroy
 *    the road's *live* intermediate and black out the road frame until its next
 *    resize. So the wrapper never receives the real texture: it gets
 *    `neuterDestroy(texture)`, a pass-through whose `destroy()` does nothing.
 *    The road renderer keeps sole ownership of the texture's lifetime.
 *
 * 2. **Bind-group views are cached by size.** three caches the `GPUTextureView`
 *    under `view-<w>-<h>-<mips>`. When the road renderer replaces its
 *    intermediate at the *same* size (an HDR format change, a re-init) re-pointing
 *    the existing wrapper would keep serving a view of the destroyed texture. A
 *    changed texture identity therefore always gets a **new** wrapper, which has
 *    no cache.
 *
 * Because the source is destroy-proof, a wrapper three has finished with *can* be
 * disposed — and is, so three's per-texture bookkeeping (its dispose listener and
 * `renderer.info.memory.textures`) is released instead of drifting up on every
 * road resize. That is safe only because of (1); dispose a wrapper around a raw
 * road texture and the road's next frame fails validation.
 *
 * The texture is also destroyed and replaced by the road renderer on every
 * resize, so `sync` is called every cabin frame *before* `render()`: the
 * destroy and the replacement happen in one road-side JS task, so a fresh
 * `getFrame()` never hands back a destroyed texture.
 */

/** Anything with a swappable texture — a TSL `texture()` node. */
export interface TextureSlot {
    value: unknown;
}

/**
 * A view of `texture` whose `destroy()` is a no-op. Everything else — including
 * getters and methods, which WebGPU brand-checks against the real object — is
 * forwarded to the real texture.
 */
export function neuterDestroy<T extends object>(texture: T): T {
    return new Proxy(texture, {
        get(target, prop) {
            if (prop === 'destroy') return () => undefined;
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/** three's description of each intermediate format the renderer can pick. */
export function threeLayoutForFormat(
    format: GPUTextureFormat,
): { format: THREE.AnyPixelFormat; type: THREE.TextureDataType } {
    if (format === 'rg11b10ufloat') {
        return { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type };
    }
    // rgba16float, and the safe default: both filter, both sample as float.
    return { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
}

export class RoadFrameBinding {
    private boundTexture: GPUTexture | null = null;
    private wrapper: THREE.ExternalTexture | null = null;

    constructor(private readonly slot: TextureSlot) {}

    /**
     * Point the slot at this frame's intermediate. Returns false when there is
     * no frame — the caller then leaves the portal on its hole fallback.
     */
    sync(frame: RoadHdrFrame | null): boolean {
        if (!frame) return false;
        if (frame.texture !== this.boundTexture) {
            const external = new THREE.ExternalTexture(neuterDestroy(frame.texture));
            const layout = threeLayoutForFormat(frame.format);
            external.name = 'roadHdrFrame';
            external.format = layout.format;
            external.type = layout.type;
            external.minFilter = THREE.LinearFilter;
            external.magFilter = THREE.LinearFilter;
            external.generateMipmaps = false;
            external.colorSpace = THREE.NoColorSpace;
            external.needsUpdate = true;
            const previous = this.wrapper;
            this.wrapper = external;
            this.boundTexture = frame.texture;
            this.slot.value = external;
            // Safe: its source cannot be destroyed through it (module note).
            previous?.dispose();
        }
        return true;
    }

    isBound(): boolean {
        return this.wrapper !== null;
    }

    /** The current wrapper, for tests and the probe. */
    getWrapper(): THREE.ExternalTexture | null {
        return this.wrapper;
    }

    /** Forget the road texture. Never destroys it. */
    release(): void {
        this.boundTexture = null;
        this.wrapper?.dispose();
        this.wrapper = null;
    }
}
