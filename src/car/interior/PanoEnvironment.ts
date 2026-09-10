import * as THREE from 'three';
import { type CabinRenderer } from './createCabinRenderer';
import { createCabinPmrem, type CabinEnvTarget, type CabinPmrem } from './cabinPmrem';

/**
 * PanoEnvironment
 *
 * Turns a low-res equirect image of the current Street View panorama into the
 * scene's IBL environment via PMREM, so interior materials reflect the actual
 * surroundings instead of a canned studio box.
 *
 * - The PMREM render target from the previous pano is disposed on every swap.
 * - Heading alignment is `scene.environmentRotation` (Y), not a pixel blit of
 *   the equirect: three samples equirect maps with u=0.5 at world +X, and the
 *   source image has `centerHeading` at u=0.5.
 * - Night dim is `scene.environmentIntensity`. Note that on both backends the
 *   *scene* environment ignores a material's authored `envMapIntensity`
 *   entirely (WebGLRenderer overwrites that uniform with
 *   `scene.environmentIntensity`; the node path picks one or the other in
 *   `MaterialProperties.js`) — authored values only bite when a material sets
 *   its own `envMap`, which no cabin material does. So there is nothing to
 *   scale per material, and the old full-scene walk was already inert.
 */
export class PanoEnvironment {
    private pmrem: CabinPmrem | null = null;
    private currentRT: CabinEnvTarget | null = null;
    private intensity = 1;

    constructor(
        private readonly renderer: CabinRenderer,
        private scene: THREE.Scene
    ) {
        this.scene.environmentIntensity = this.intensity;
    }

    /**
     * Replace the scene environment with a PMREM-filtered version of the given
     * equirect pano image. `centerHeading` is the compass heading (degrees) at
     * the horizontal centre of the image.
     *
     * Works on both cabin backends — `cabinPmrem.ts` picks the PMREM generator
     * that matches the renderer. Only called on pano hops, so the renderer is
     * long since initialized and the synchronous path is safe.
     */
    public setFromEquirect(equirect: HTMLCanvasElement, centerHeading: number): void {
        const texture = new THREE.CanvasTexture(equirect);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        if (!this.pmrem) this.pmrem = createCabinPmrem(this.renderer);
        if (!this.pmrem) {
            texture.dispose();
            return;
        }
        const newRT = this.pmrem.fromEquirectangular(texture);
        texture.dispose();

        const oldEnv = this.scene.environment;
        this.scene.environment = newRT.texture;
        this.scene.environmentRotation.y = headingRotationY(centerHeading);
        // Dispose the previous pano's render target; the very first swap
        // replaces the static studio env texture from LightingBuilder instead.
        if (this.currentRT) this.currentRT.dispose();
        else if (oldEnv) oldEnv.dispose();
        this.currentRT = newRT;

        // Re-assert the current dim level in case it was set before the first
        // pano arrived (a fresh scene defaults to 1).
        this.scene.environmentIntensity = this.intensity;
    }

    /**
     * Scale the environment contribution (1 = authored daytime look, lower =
     * night). No-op below a 1% change.
     */
    public setIntensity(factor: number): void {
        const clamped = Math.max(0, Math.min(1, factor));
        if (Math.abs(clamped - this.intensity) < 0.01) return;
        this.intensity = clamped;
        this.scene.environmentIntensity = clamped;
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

/**
 * Y rotation (radians) that puts compass heading `centerHeading` — the middle
 * column of the equirect — back where it belongs in world space.
 *
 * three samples equirect maps as `u = atan2(dir.z, dir.x) / 2π + 0.5`, so
 * u=0.5 is world +X, which is compass east (heading 90°) in this scene's frame
 * (heading H maps to `(sin H, 0, -cos H)`). `environmentRotation` rotates the
 * lookup direction, and a Y rotation by `a` shifts the sampled angle by `-a`,
 * which is exactly the old `(centerHeading - 90)/360 * width` pixel shift.
 */
export function headingRotationY(centerHeading: number): number {
    return THREE.MathUtils.degToRad(centerHeading - 90);
}
