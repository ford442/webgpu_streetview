/**
 * LimousineMode.ts - Luxury limousine interior with partition glass, rear-facing seats,
 * mini bar, entertainment screens, and mood lighting system.
 */

import * as THREE from 'three';
import { LimoInteriorBuilder } from './LimoInteriorBuilder';

/**
 * Limousine state interface for managing partition, lighting, and entertainment
 */
export interface LimoState {
    partitionOpen: boolean;
    moodLighting: 'relaxing' | 'business' | 'party' | 'romantic';
    entertainmentOn: boolean;
    intercomActive: boolean;
    chauffeurView: boolean;
    barLightOn: boolean;
    screenContent: 'none' | 'nav' | 'entertainment' | 'ambient';
}

/**
 * Default limousine state
 */
export const defaultLimoState: LimoState = {
    partitionOpen: false,
    moodLighting: 'relaxing',
    entertainmentOn: false,
    intercomActive: false,
    chauffeurView: false,
    barLightOn: true,
    screenContent: 'ambient',
};

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
    private luxuryLeatherMaterial!: THREE.MeshStandardMaterial;
    private woodMaterial!: THREE.MeshStandardMaterial;
    private chromeMaterial!: THREE.MeshStandardMaterial;
    private partitionGlassMaterial!: THREE.MeshPhysicalMaterial;
    private screenMaterial!: THREE.MeshStandardMaterial;
    private velvetMaterial!: THREE.MeshStandardMaterial;
    private carpetMaterial!: THREE.MeshStandardMaterial;

    // Lights
    private moodLights: THREE.PointLight[] = [];
    private barLight!: THREE.PointLight;
    private ambientLight!: THREE.AmbientLight;
    private ceilingLights: THREE.SpotLight[] = [];

    // State
    private state: LimoState;
    private partitionTargetY: number = 0;
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

        this.luxuryLeatherMaterial = builder.luxuryLeatherMaterial;
        this.woodMaterial = builder.woodMaterial;
        this.chromeMaterial = builder.chromeMaterial;
        this.partitionGlassMaterial = builder.partitionGlassMaterial;
        this.screenMaterial = builder.screenMaterial;
        this.velvetMaterial = builder.velvetMaterial;
        this.carpetMaterial = builder.carpetMaterial;

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
        this.partitionGlassMaterial.opacity = this.state.partitionOpen ? 0.2 : 0.9;
        this.partitionGlassMaterial.transmission = this.state.partitionOpen ? 0.8 : 0.1;
    }

    private updateMoodLighting(): void {
        const moodColors: Record<string, number[]> = {
            relaxing: [0xff8844, 0xffaa66, 0xffcc88, 0xffddaa],
            business: [0xffffff, 0xffffee, 0xffffdd, 0xffffff],
            party: [0xff0088, 0x8800ff, 0x0088ff, 0x00ff88],
            romantic: [0xff4466, 0xff6688, 0xff88aa, 0xffaacc],
        };

        const colors = moodColors[this.state.moodLighting] || moodColors.relaxing;
        const intensity = this.state.entertainmentOn ? 0.8 : 0.4;

        this.moodLights.forEach((light, idx) => {
            light.color.setHex(colors[idx % colors.length]);
            light.intensity = intensity;
        });

        switch (this.state.moodLighting) {
            case 'relaxing':
                this.ambientLight.color.setHex(0xffddaa);
                this.ambientLight.intensity = 0.15;
                break;
            case 'business':
                this.ambientLight.color.setHex(0xffffff);
                this.ambientLight.intensity = 0.3;
                break;
            case 'party':
                this.ambientLight.color.setHex(0xff00ff);
                this.ambientLight.intensity = 0.1;
                break;
            case 'romantic':
                this.ambientLight.color.setHex(0xffaabb);
                this.ambientLight.intensity = 0.12;
                break;
        }

        if (this.state.barLightOn) {
            this.barLight.intensity = 0.5;
        } else {
            this.barLight.intensity = 0;
        }
    }

    private updateScreenContent(): void {
        const contentColors: Record<string, number> = {
            none: 0x000000,
            nav: 0x002244,
            entertainment: 0x440022,
            ambient: 0x112233,
        };

        const emissiveIntensity = this.state.entertainmentOn ? 0.8 : 0.2;
        const color = contentColors[this.state.screenContent] || contentColors.ambient;

        this.screensGroup.children.forEach((child) => {
            if (child.name.includes('Screen')) {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.emissive.setHex(color);
                mat.emissiveIntensity = emissiveIntensity;
            }
        });
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

    public update(deltaTime: number): void {
        if (this.state.entertainmentOn && this.state.moodLighting === 'party') {
            const time = performance.now() * 0.001;
            this.moodLights.forEach((light, idx) => {
                const offset = idx * Math.PI / 2;
                light.intensity = 0.5 + Math.sin(time * 2 + offset) * 0.3;
            });
        }

        this.ceilingLights.forEach((light, idx) => {
            const time = performance.now() * 0.001;
            light.intensity = 0.2 + Math.sin(time * 0.5 + idx) * 0.1;
        });
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
