import * as THREE from 'three';
import { PostProcessingManager } from './PostProcessingManager';
import { CameraFovConfig, zoomToVerticalFov } from '../vehicleLayout';

export class CarInteriorRenderer {
    /** Post-FX (bloom/SMAA/OutputPass) breaks alpha compositing over the WebGPU panorama. */
    private postProcessingActive = false;
    private cameraFov: CameraFovConfig;

    constructor(
        private renderer: THREE.WebGLRenderer,
        private camera: THREE.PerspectiveCamera,
        private scene: THREE.Scene,
        private postProcessing: PostProcessingManager | undefined,
        private canvas: HTMLCanvasElement,
        cameraFov: CameraFovConfig,
    ) {
        this.cameraFov = cameraFov;
        this.camera.fov = cameraFov.base;
        this.camera.updateProjectionMatrix();
    }

    public setCameraFov(fov: CameraFovConfig): void {
        this.cameraFov = fov;
        this.camera.fov = fov.base;
        this.camera.updateProjectionMatrix();
    }

    public render(): void {
        if (this.postProcessing && this.postProcessingActive) {
            this.postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
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
