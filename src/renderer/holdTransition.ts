import { TransitionManager } from './TransitionManager';
import { TextureLifecycle } from './textureLifecycle';

export interface HoldTransitionDeps {
    getDevice: () => GPUDevice;
    getTransitionManager: () => TransitionManager | undefined;
    getTextures: () => TextureLifecycle;
    updateBindGroup: () => void;
}

/**
 * Hold-pause state: snapshot outgoing frame and refuse live uploads until release.
 */
export class HoldTransitionController {
    private holdActive = false;
    private capturePanX = 0.5;
    private capturePanY = 0.5;

    constructor(private readonly deps: HoldTransitionDeps) {}

    isHoldActive(): boolean {
        return this.holdActive;
    }

    getCapturePan(): { x: number; y: number } {
        return { x: this.capturePanX, y: this.capturePanY };
    }

    beginHoldTransition(heading?: number, pitch?: number, cpuSnapshot?: HTMLCanvasElement): void {
        const textures = this.deps.getTextures();
        const transitionManager = this.deps.getTransitionManager();

        if (textures.videoTexture) {
            transitionManager?.captureCurrentFrame(textures.videoTexture);
            this.deps.updateBindGroup();
        } else if (cpuSnapshot && cpuSnapshot.width >= 256 && cpuSnapshot.height >= 256) {
            textures.createVideoTexture(cpuSnapshot.width, cpuSnapshot.height);
            try {
                this.deps.getDevice().queue.copyExternalImageToTexture(
                    { source: cpuSnapshot },
                    { texture: textures.videoTexture! },
                    [cpuSnapshot.width, cpuSnapshot.height]
                );
                transitionManager?.captureCurrentFrame(textures.videoTexture!);
                this.deps.updateBindGroup();
            } catch (e) {
                console.warn('[Renderer] CPU hold snapshot upload failed:', e);
            }
        } else {
            console.warn('[Renderer] beginHoldTransition: no GPU or CPU snapshot available');
        }

        this.capturePanX = ((heading ?? 0) % 360) / 360;
        this.capturePanY = ((pitch ?? 0) + 90) / 180;
        this.holdActive = true;
        transitionManager?.setTransitionProgress(0.0);
    }

    endHoldTransition(): void {
        this.holdActive = false;
    }

    shouldRenderHeldFrame(): boolean {
        const textures = this.deps.getTextures();
        const transitionManager = this.deps.getTransitionManager();
        return this.holdActive && !!transitionManager?.previousFrame && !!textures.videoTexture;
    }
}
