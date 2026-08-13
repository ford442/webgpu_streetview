/**
 * LimousineMode.ts - Luxury limousine interior with partition glass, rear-facing seats,
 * mini bar, entertainment screens, and mood lighting system.
 */

import * as THREE from 'three';
import { LimoInteriorBuilder } from './LimoInteriorBuilder';
import {
    applyLimoMoodLighting,
    applyLimoScreenContent,
    applyPartitionGlass,
    defaultLimoState,
    tickLimoAtmosphere,
    type LimoState,
} from './limousine/limoAtmosphere';

export type { LimoState };
export { defaultLimoState };

/**
 * LimousineMode - Extended luxury cabin with privacy partition, rear-facing seats,
 * mini bar, entertainment screens, and dynamic mood lighting.
 */
export class LimousineMode {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;

    private interiorGroup: THREE.Group;
    private partitionGroup: THREE.Group;
    private moodLightsGroup: THREE.Group;
    private entertainmentGroup: THREE.Group;
    private barGroup: THREE.Group;
    private screensGroup: THREE.Group;

    // Materials
    private partitionGlassMaterial!: THREE.MeshPhysicalMaterial;

    // Lights
    private moodLights: THREE.PointLight[] = [];
    private barLight!: THREE.PointLight;
    private ambientLight!: THREE.AmbientLight;
    private ceilingLights: THREE.SpotLight[] = [];

    // State
    private state: LimoState;
    private animationId: number = 0;

    constructor(container: HTMLElement, initialState: Partial<LimoState> = {}) {
        this.state = { ...defaultLimoState, ...initialState };

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.01,
            100
        );
        this.camera.position.set(0, 1.3, 1.5);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = false;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '100';
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        container.appendChild(this.canvas);

        const builder = new LimoInteriorBuilder(this.scene, this.state);
        builder.buildAll();

        this.interiorGroup = builder.interiorGroup;
        this.partitionGroup = builder.partitionGroup;
        this.moodLightsGroup = builder.moodLightsGroup;
        this.entertainmentGroup = builder.entertainmentGroup;
        this.barGroup = builder.barGroup;
        this.screensGroup = builder.screensGroup;

        this.partitionGlassMaterial = builder.partitionGlassMaterial;

        this.moodLights = builder.moodLights;
        this.barLight = builder.barLight;
        this.ambientLight = builder.ambientLight;
        this.ceilingLights = builder.ceilingLights;

        this.scene.add(this.interiorGroup);
        this.scene.add(this.partitionGroup);
        this.scene.add(this.moodLightsGroup);
        this.scene.add(this.entertainmentGroup);
        this.scene.add(this.barGroup);
        this.scene.add(this.screensGroup);

        this.updatePartitionPosition();
        this.updateMoodLighting();
        this.updateScreenContent();
    }

    private updatePartitionPosition(): void {
        applyPartitionGlass(this.partitionGlassMaterial, this.state.partitionOpen);
    }

    private updateMoodLighting(): void {
        applyLimoMoodLighting(this.state, this.moodLights, this.ambientLight, this.barLight);
    }

    private updateScreenContent(): void {
        applyLimoScreenContent(this.screensGroup, this.state);
    }

    // Public API methods

    public togglePartition(): boolean {
        this.state.partitionOpen = !this.state.partitionOpen;
        this.updatePartitionPosition();
        return this.state.partitionOpen;
    }

    public setMoodLighting(mode: LimoState['moodLighting']): void {
        this.state.moodLighting = mode;
        this.updateMoodLighting();
    }

    public getMoodLighting(): LimoState['moodLighting'] {
        return this.state.moodLighting;
    }

    public toggleEntertainment(): boolean {
        this.state.entertainmentOn = !this.state.entertainmentOn;
        this.updateMoodLighting();
        this.updateScreenContent();
        return this.state.entertainmentOn;
    }

    public setScreenContent(content: LimoState['screenContent']): void {
        this.state.screenContent = content;
        this.updateScreenContent();
    }

    public toggleBarLight(): boolean {
        this.state.barLightOn = !this.state.barLightOn;
        this.updateMoodLighting();
        return this.state.barLightOn;
    }

    public toggleIntercom(): boolean {
        this.state.intercomActive = !this.state.intercomActive;
        this.interiorGroup.children.forEach((child) => {
            if (child.name === 'intercomButton') {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = this.state.intercomActive ? 0.5 : 0;
            }
        });
        return this.state.intercomActive;
    }

    public toggleChauffeurView(): boolean {
        this.state.chauffeurView = !this.state.chauffeurView;
        if (this.state.chauffeurView) {
            this.camera.position.set(0, 1.2, -0.2);
        } else {
            this.camera.position.set(0, 1.3, 1.5);
        }
        return this.state.chauffeurView;
    }

    public getState(): LimoState {
        return { ...this.state };
    }

    public setState(newState: Partial<LimoState>): void {
        this.state = { ...this.state, ...newState };
        this.updatePartitionPosition();
        this.updateMoodLighting();
        this.updateScreenContent();
        if (this.state.chauffeurView) {
            this.camera.position.set(0, 1.2, -0.2);
        } else {
            this.camera.position.set(0, 1.3, 1.5);
        }
    }

    public update(_deltaTime: number): void {
        tickLimoAtmosphere(
            this.state,
            this.moodLights,
            this.ceilingLights,
            performance.now() * 0.001,
        );
    }

    public setHeadOrientation(headYaw: number, headPitch: number): void {
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));

        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);

        this.camera.rotation.set(-pitchRad, yawRad, 0);
    }

    public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        const pitchRad = THREE.MathUtils.degToRad(bodyPitch);
        const rollRad = THREE.MathUtils.degToRad(bodyRoll);
        this.interiorGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.partitionGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.barGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.screensGroup.rotation.set(pitchRad, yawRad, rollRad);
    }

    public render(): void {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }

    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    public dispose(): void {
        cancelAnimationFrame(this.animationId);
        this.renderer.dispose();

        const disposeObject = (obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        };

        this.scene.traverse(disposeObject);

        if (this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
    }
}

export function initLimousineMode(
    container: HTMLElement,
    initialState?: Partial<LimoState>
): LimousineMode {
    return new LimousineMode(container, initialState);
}

export default LimousineMode;
