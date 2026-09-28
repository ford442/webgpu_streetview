import * as THREE from 'three';
import { getRoadFrameSource } from '../../renderer/roadFrameRegistry';
import type { CabinTslApi } from './cabinTslMaterials';
import type { WindshieldPortalMaterial } from './cabinPortalMaterial';
import { computeTempMult } from './portalGrade';
import { RoadFrameBinding } from './roadFrameBinding';
import { computeApertureLocalPlanes, computeGlassAspect } from './windshieldAperture';
import { WindshieldWetMask } from './windshieldWetMask';

/**
 * The windshield **portal**: what `WindowWeatherOverlay` draws instead of its
 * decal when the shared WebGPU device has `clip-distances`.
 *
 * The glass stays a hole onto the road frame. This layer adds wet-glass optics on
 * top of it — droplet lenses that sample the road's **HDR intermediate** (the
 * pass-1 texture `renderer/roadFrameRegistry.ts` publishes), with the wipers
 * clearing a persistent wet mask. See `cabinPortalMaterial.ts` for the shading
 * and why only lens interiors sample the road.
 *
 * ### What this class owns
 *
 * - the portal mesh, inside a `WorldPlaneClippingGroup` trimmed to the glass
 *   aperture (hardware clip distances),
 * - the wet mask (`windshieldWetMask.ts`), stepped from the animator's wiper
 *   phase — the same number that swings the blades,
 * - the per-frame road-frame binding and look mirror.
 *
 * ### Never sampled
 *
 * The hidden Google Maps canvas, `videoTexture`, the rear-view feed. The only
 * road input is `RoadHdrFrame.texture`, and while a hop is held pass 1 is drawing
 * the frozen snapshot, so what the glass refracts is the held frame. Forward glass
 * only: the mirror / vanity glass never touch this class, so rear-view billing
 * rules are untouched.
 *
 * ### Fallback
 *
 * `update()` reports whether a road frame was available. With none — the renderer
 * is not up yet, was torn down, or the device was lost mid-session — `isLive()`
 * turns false and `WindowWeatherOverlay` swaps the decal back in, so the glass
 * degrades to exactly today's hole + overlay rather than showing nothing.
 */

export interface WindshieldPortalOptions {
    /** Inset of the clip aperture from the glass edge (mesh units). Defaults to `APERTURE_INSET`. */
    apertureInset?: number;
    /**
     * The device the cabin renderer is on. A road frame owned by a different
     * device is refused (see `update`). Omit to skip the check.
     */
    cabinDevice?: object;
}

export interface PortalFrameState {
    /** A road frame was bound this update. */
    live: boolean;
    /** That frame is the hold-pause snapshot. */
    held: boolean;
    /** Road frame format, when live. */
    format?: GPUTextureFormat;
    /** Why the portal is not live this update. Undefined when it is. */
    reason?: string;
}

const NO_FRAME_REASON = 'No road HDR frame — hole + decal overlay.';
const OTHER_DEVICE_REASON = 'The road frame is on a different GPUDevice — hole + decal overlay.';

export class WindshieldPortal {
    readonly root: THREE.Object3D;
    private readonly mesh: THREE.Mesh;
    private readonly material: WindshieldPortalMaterial;
    private readonly wetMask = new WindshieldWetMask();
    private readonly binding: RoadFrameBinding;

    private rain = 0;
    private wipersActive = false;
    private wiperPhase = 0;
    private readonly cabinDevice: object | undefined;
    private live = false;
    private lastTemperature = NaN;
    private lastTint = NaN;

    /**
     * @param decal The overlay mesh: the portal reuses its geometry and its
     *   (already nudged-toward-the-cabin) transform, so the two layers register
     *   exactly and only one of them is visible at a time.
     * @param windshield The glass mesh, for the aperture and aspect.
     */
    constructor(
        tsl: CabinTslApi,
        decal: THREE.Mesh,
        windshield: THREE.Mesh,
        options: WindshieldPortalOptions = {},
    ) {
        this.cabinDevice = options.cabinDevice;
        this.material = tsl.createWindshieldPortalMaterial(this.wetMask.texture);
        this.material.uniforms.glassAspect.value = computeGlassAspect(
            windshield.geometry,
            windshield.scale,
        );
        this.binding = new RoadFrameBinding(this.material.uniforms.hdrFrame);

        this.mesh = new THREE.Mesh(decal.geometry, this.material);
        this.mesh.name = 'windshieldPortal';
        this.mesh.position.copy(decal.position);
        this.mesh.rotation.copy(decal.rotation);
        this.mesh.scale.copy(decal.scale);
        this.mesh.renderOrder = decal.renderOrder;
        this.mesh.visible = false;

        windshield.updateMatrix();
        this.root = tsl.createWorldPlaneClippingGroup(
            computeApertureLocalPlanes(windshield.geometry, windshield.matrix, options.apertureInset),
        );
        this.root.add(this.mesh);
    }

    getMesh(): THREE.Mesh {
        return this.mesh;
    }

    getMaterial(): WindshieldPortalMaterial {
        return this.material;
    }

    getWetMask(): WindshieldWetMask {
        return this.wetMask;
    }

    isLive(): boolean {
        return this.live;
    }

    /** `rainNorm` is the cabin's 0..1 (with the wiper mist seed already applied). */
    setWeather(rainNorm: number, condensation: number): void {
        this.rain = rainNorm;
        this.material.uniforms.rainIntensity.value = rainNorm;
        this.material.uniforms.condensation.value = condensation;
    }

    /** Phase is the animator's; this never free-runs it. */
    setWipers(active: boolean, phase: number): void {
        this.wipersActive = active;
        this.wiperPhase = phase;
    }

    /**
     * Step the wet mask and bind this frame's road texture. Call once per cabin
     * frame **before** `render()` — the road renderer replaces its intermediate on
     * resize, so the binding has to be refreshed every frame (see
     * `roadFrameBinding.ts`).
     */
    update(deltaSeconds: number): PortalFrameState {
        const u = this.material.uniforms;
        u.time.value += deltaSeconds;
        this.wetMask.update(
            deltaSeconds,
            { active: this.wipersActive, phase: this.wiperPhase },
            this.rain,
        );

        const frame = getRoadFrameSource()?.getFrame() ?? null;
        if (frame && this.cabinDevice && frame.device !== this.cabinDevice) {
            // The road renderer was replaced onto another device and this cabin
            // has not been rebuilt yet. Its texture is unusable here (a validation
            // error on every submit), so stay on the decal until the cabin follows.
            this.live = false;
            return { live: false, held: false, reason: OTHER_DEVICE_REASON };
        }
        this.live = this.binding.sync(frame);
        if (!frame) return { live: false, held: false, reason: NO_FRAME_REASON };

        const look = frame.look;
        u.vibrance.value = look.vibrance;
        u.saturation.value = look.saturation;
        u.contrast.value = look.contrast;
        u.exposure.value = look.exposure;
        u.nightIntensity.value = look.nightIntensity;
        u.roadRain.value = look.rainIntensity;
        u.graded.value = look.graded ? 1 : 0;
        if (look.temperature !== this.lastTemperature || look.tint !== this.lastTint) {
            this.lastTemperature = look.temperature;
            this.lastTint = look.tint;
            const [r, g, b] = computeTempMult(look.temperature, look.tint);
            u.tempMult.value.set(r, g, b);
        }

        return { live: true, held: frame.held, format: frame.format };
    }

    dispose(): void {
        // The road texture belongs to the renderer — `release()` only forgets it.
        this.binding.release();
        this.wetMask.dispose();
        this.material.dispose();
        this.root.removeFromParent();
    }
}
