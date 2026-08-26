import * as THREE from 'three';
import { isWebGPUCabinRenderer, type CabinRenderer } from './createCabinRenderer';

/**
 * PanoEnvironment
 *
 * Turns a low-res equirect image of the current Street View panorama into the
 * scene's IBL environment via PMREM, so interior materials reflect the actual
 * surroundings instead of a canned studio box.
 *
 * - The PMREM render target from the previous pano is disposed on every swap.
 * - The pano heading is baked into the equirect by shifting the image so that
 *   compass alignment matches three's equirect convention (u=0.5 → +X → east);
 *   three 0.160 has no `scene.environmentRotation`.
 * - `setIntensity` scales every material's `envMapIntensity` relative to its
 *   authored value (three 0.160 has no `scene.environmentIntensity`), used to
 *   dim the environment contribution at night.
 */
export class PanoEnvironment {
    private pmrem: THREE.PMREMGenerator | null = null;
    private currentRT: THREE.WebGLRenderTarget | null = null;
    private shiftCanvas: HTMLCanvasElement;
    private intensity = 1;

    constructor(
        private readonly renderer: CabinRenderer,
        private scene: THREE.Scene
    ) {
        this.shiftCanvas = document.createElement('canvas');
    }

    /**
     * Replace the scene environment with a PMREM-filtered version of the given
     * equirect pano image. `centerHeading` is the compass heading (degrees) at
     * the horizontal centre of the image.
     *
     * No-op on the `?cabin=webgpu` escape hatch — classic `THREE.PMREMGenerator`
     * is WebGL-only; see `createCabinRenderer.ts`.
     */
    public setFromEquirect(equirect: HTMLCanvasElement, centerHeading: number): void {
        if (isWebGPUCabinRenderer(this.renderer)) return;
        const W = equirect.width;
        const H = equirect.height;
        this.shiftCanvas.width = W;
        this.shiftCanvas.height = H;
        const ctx = this.shiftCanvas.getContext('2d')!;

        // three samples equirect maps with u=0.5 at world +X (compass east in
        // this scene's frame, where heading H maps to (sin H, 0, -cos H)).
        // The source image has `centerHeading` at u=0.5, so shift it right by
        // (centerHeading - 90)° worth of pixels, wrapping the seam.
        const shiftPx = Math.round((((centerHeading - 90) / 360) % 1 + 1) % 1 * W);
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(equirect, shiftPx, 0);
        ctx.drawImage(equirect, shiftPx - W, 0);

        const texture = new THREE.CanvasTexture(this.shiftCanvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
        const newRT = this.pmrem.fromEquirectangular(texture);
        texture.dispose();

        const oldEnv = this.scene.environment;
        this.scene.environment = newRT.texture;
        // Dispose the previous pano's render target; the very first swap
        // replaces the static studio env texture from LightingBuilder instead.
        if (this.currentRT) this.currentRT.dispose();
        else if (oldEnv) oldEnv.dispose();
        this.currentRT = newRT;

        // New env texture resets nothing on materials, but re-assert the
        // current dim level in case it was set before the first pano arrived.
        this.applyIntensity();
    }

    /**
     * Scale the environment contribution on all scene materials (1 = authored
     * daytime look, lower = night). No-op below a 1% change to avoid per-frame
     * traversals.
     */
    public setIntensity(factor: number): void {
        const clamped = Math.max(0, Math.min(1, factor));
        if (Math.abs(clamped - this.intensity) < 0.01) return;
        this.intensity = clamped;
        this.applyIntensity();
    }

    private applyIntensity(): void {
        this.scene.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) {
                const std = mat as THREE.MeshStandardMaterial;
                if (typeof std.envMapIntensity !== 'number') continue;
                if (std.userData.baseEnvMapIntensity === undefined) {
                    std.userData.baseEnvMapIntensity = std.envMapIntensity;
                }
                std.envMapIntensity = std.userData.baseEnvMapIntensity * this.intensity;
            }
        });
    }

    public dispose(): void {
        if (this.currentRT) {
            this.currentRT.dispose();
            this.currentRT = null;
        }
        if (this.pmrem) {
            this.pmrem.dispose();
            this.pmrem = null;
        }
    }
}
