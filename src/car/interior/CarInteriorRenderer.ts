import * as THREE from 'three';
import type { PostProcessingManager } from './PostProcessingManager';
import { CameraFovConfig, zoomToVerticalFov } from '../vehicleLayout';
import type { CabinRenderer } from './createCabinRenderer';
import { CabinFrameTarget } from './cabinFrameTarget';
import { publishCabinCompositeState } from './cabinRendererProbe';
import type { CabinOverlaySource } from '../../renderer/cabinComposite';

export class CarInteriorRenderer {
    /** Post-FX (bloom/SMAA/OutputPass) breaks alpha compositing over the WebGPU panorama. */
    private postProcessingActive = false;
    private cameraFov: CameraFovConfig;
    /**
     * Set on the WebGPU cabin: the interior draws into a `GPUTexture` the
     * Street View renderer composites into its own frame, instead of a second
     * canvas the page stacks in CSS. Null on the `?cabin=webgl` hatch, where
     * the CSS overlay and the 2D cinema latch stay in charge.
     */
    private frameTarget: CabinFrameTarget | null = null;

    constructor(
        private renderer: CabinRenderer,
        private camera: THREE.PerspectiveCamera,
        private scene: THREE.Scene,
        private postProcessing: PostProcessingManager | undefined,
        private canvas: HTMLCanvasElement,
        cameraFov: CameraFovConfig,
        /** WebGPU only — false until `createCabinRenderer`'s async init resolves; always true for WebGL. */
        private isRendererReady: () => boolean = () => true,
    ) {
        this.cameraFov = cameraFov;
        this.camera.fov = cameraFov.base;
        this.camera.updateProjectionMatrix();

        const adoption = CabinFrameTarget.create(this.renderer, {
            canvas: this.canvas,
            onUnavailable: (reason) => publishCabinCompositeState(false, reason),
        });
        this.frameTarget = adoption.target;
        publishCabinCompositeState(this.frameTarget !== null, adoption.reason);
    }

    /**
     * The cabin texture for `renderer/cabinOverlayRegistry`, or null when this
     * cabin cannot be composited into the road frame. `car/runtime/lifecycle.ts`
     * publishes it while car mode is active and retracts it on toggle-off.
     */
    public getCabinOverlaySource(): CabinOverlaySource | null {
        return this.frameTarget?.asOverlaySource() ?? null;
    }

    /** True while the cabin is actually feeding the one-frame compositor. */
    public isCompositedIntoRoadFrame(): boolean {
        return this.frameTarget?.isActive() === true;
    }

    public setCameraFov(fov: CameraFovConfig): void {
        this.cameraFov = fov;
        this.camera.fov = fov.base;
        this.camera.updateProjectionMatrix();
    }

    public render(): void {
        if (!this.isRendererReady()) return;
        if (this.postProcessing && this.postProcessingActive) {
            // EffectComposer owns its own targets and its own output; the
            // one-frame path stays off for as long as post-FX is on.
            this.postProcessing.render();
            return;
        }
        const frameTarget = this.frameTarget;
        if (!frameTarget || !frameTarget.isActive()) {
            this.renderer.render(this.scene, this.camera);
            return;
        }
        frameTarget.beginFrame();
        this.renderer.render(this.scene, this.camera);
        // Latches the CSS-overlay fallback if the backend never handed over a
        // texture, which is only observable after a real draw. `onUnavailable`
        // reports it once.
        frameTarget.endFrame();
    }

    /** Release the offscreen target and put the cabin canvas back on screen. */
    public dispose(): void {
        this.frameTarget?.dispose();
        this.frameTarget = null;
    }

    public setTargetFPS(_fps: number): void {
        // Frame limiting is handled by the caller; this is a no-op placeholder
        // for future frame-rate capping integration.
    }

    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        if (this.postProcessing) {
            this.postProcessing.setSize(width, height);
        }
    }

    public setZoomFOV(zoom: number): void {
        this.camera.fov = zoomToVerticalFov(zoom, this.cameraFov);
        this.camera.updateProjectionMatrix();
    }

    public setPostProcessingEnabled(enabled: boolean): void {
        this.postProcessingActive = enabled;
        if (this.postProcessing) {
            this.postProcessing.setEnabled(enabled);
        }
    }

    public setBloomStrength(strength: number): void {
        if (this.postProcessing) {
            this.postProcessing.setBloomStrength(strength);
        }
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
