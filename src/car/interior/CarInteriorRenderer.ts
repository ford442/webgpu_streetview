import * as THREE from 'three';
import type { PostProcessingManager } from './PostProcessingManager';
import { panoramaMatchedVerticalFov } from '../../utils/streetViewFov';
import type { CabinRenderer } from './createCabinRenderer';
import { CabinFrameTarget } from './cabinFrameTarget';
import { publishCabinCompositeState } from './cabinRendererProbe';
import type { CabinOverlaySource } from '../../renderer/cabinComposite';
import { getCabinStereoRequest, type CabinStereoRequest } from '../../renderer/cabinStereoRequest';
import { createEyeCameras, eyeViewport, updateEyeCameras, type EyeCameras } from './cabinStereo';

export class CarInteriorRenderer {
    /** Post-FX (bloom/SMAA/OutputPass) breaks alpha compositing over the WebGPU panorama. */
    private postProcessingActive = false;
    /** Last Street View store zoom; the FOV is re-derived from it on resize. */
    private zoom = 1;
    /**
     * Set on the WebGPU cabin: the interior draws into a `GPUTexture` the
     * Street View renderer composites into its own frame, instead of a second
     * canvas the page stacks in CSS. Null on the `?cabin=webgl` hatch, where
     * the CSS overlay and the 2D cinema latch stay in charge.
     */
    private frameTarget: CabinFrameTarget | null = null;
    /** #331: the two eye cameras, built the first time stereo is asked for. */
    private eyes: EyeCameras | null = null;

    constructor(
        private renderer: CabinRenderer,
        private camera: THREE.PerspectiveCamera,
        private scene: THREE.Scene,
        private postProcessing: PostProcessingManager | undefined,
        private canvas: HTMLCanvasElement,
        /** WebGPU only — false until `createCabinRenderer`'s async init resolves; always true for WebGL. */
        private isRendererReady: () => boolean = () => true,
    ) {
        this.applyPanoramaFov();

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
            void this.renderer.render(this.scene, this.camera);
            return;
        }
        frameTarget.beginFrame();
        const stereo = getCabinStereoRequest();
        if (stereo) {
            this.renderEyes(stereo);
        } else {
            void this.renderer.render(this.scene, this.camera);
        }
        frameTarget.setLayout(stereo ? 'sbs' : 'mono');
        // Latches the CSS-overlay fallback if the backend never handed over a
        // texture, which is only observable after a real draw. `onUnavailable`
        // reports it once.
        frameTarget.endFrame();
    }

    /**
     * Both eyes into the one cabin target, left half then right (#331). The
     * viewport goes on the renderer, not the target: three renders through its
     * own framebuffer target (tone mapping / sRGB output) sized to the output
     * target and copies all of it across, so the halves must be laid out
     * there. The first eye clears the whole target (a WebGPU clear is the
     * attachment's load op — scissor does not confine it); the second loads.
     */
    private renderEyes(stereo: CabinStereoRequest): void {
        const renderer = this.renderer as CabinRenderer & { coordinateSystem: number };
        this.scene.updateMatrixWorld();
        this.camera.updateMatrixWorld();
        this.eyes ??= createEyeCameras();
        updateEyeCameras(this.eyes, this.camera, stereo, renderer.coordinateSystem);
        const size = renderer.getSize(new THREE.Vector2());
        const autoClear = renderer.autoClear;
        try {
            renderer.setScissorTest(true);
            ([this.eyes.left, this.eyes.right] as const).forEach((eye, i) => {
                const viewport = eyeViewport(i as 0 | 1, size.x, size.y);
                renderer.setViewport(viewport);
                renderer.setScissor(viewport);
                renderer.autoClear = i === 0 ? autoClear : false;
                void renderer.render(this.scene, eye);
            });
        } finally {
            renderer.autoClear = autoClear;
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, size.x, size.y);
            renderer.setScissor(0, 0, size.x, size.y);
        }
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
        if (width <= 0 || height <= 0) return;
        this.camera.aspect = width / height;
        this.applyPanoramaFov();
        this.renderer.setSize(width, height);
        if (this.postProcessing) {
            this.postProcessing.setSize(width, height);
        }
    }

    /**
     * Match the panorama's field of view. Street View zoom is a horizontal FOV
     * (≈ 180° / 2^zoom) and `camera.fov` is vertical, so this depends on the
     * aspect and is re-run on resize. A mismatch makes the outside slide
     * against the window frames as the head turns. (The per-vehicle
     * `cameraFov` endpoints no longer drive the cabin camera for that reason.)
     */
    public setZoomFOV(zoom: number): void {
        this.zoom = zoom;
        this.applyPanoramaFov();
    }

    private applyPanoramaFov(): void {
        this.camera.fov = panoramaMatchedVerticalFov(this.zoom, this.camera.aspect);
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
