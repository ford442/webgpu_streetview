import * as THREE from 'three';
import type { VehicleType } from '../../VehicleManager';
import {
    applyLimoMoodLighting,
    applyLimoScreenContent,
    applyPartitionGlass,
    defaultLimoState,
    tickLimoAtmosphere,
    type LimoState,
} from './limoAtmosphere';

export type { LimoState };
export { defaultLimoState };

/**
 * Limousine rear-cabin extras — partition, mini bar, entertainment screens,
 * mood lighting, intercom — layered onto the shared car-mode cabin.
 *
 * Same pattern as `ConvertibleMode`: this plugin shares `interior.scene` /
 * `interior.interiorGroup`, it never owns a renderer or a second scene. The
 * geometry below was ported from the orphan `LimousineMode` (closed #239/
 * #236 follow-up), which used to render into its own private
 * `THREE.WebGLRenderer` that nothing on the live path ever called.
 *
 * That standalone scene placed its rear-passenger camera at cabin-length
 * scale (z ~1.5) with the partition/bar/screens spaced out over ~2.5m.
 * `ROOT_OFFSET_Z` / `ROOT_SCALE` re-anchor and compress that into the
 * shared cabin, just behind the front seats (front seat backs sit around
 * z=0.5-0.9 — see `CarInteriorSeatBuilder`).
 */
const ROOT_OFFSET_Z = 0.85;
const ROOT_SCALE = 0.6;

export class LimoAtmosphere {
    private root = new THREE.Group();
    private partitionGroup = new THREE.Group();
    private moodLightsGroup = new THREE.Group();
    private barGroup = new THREE.Group();
    private screensGroup = new THREE.Group();

    private woodMaterial!: THREE.MeshStandardMaterial;
    private chromeMaterial!: THREE.MeshStandardMaterial;
    private partitionGlassMaterial!: THREE.MeshPhysicalMaterial;
    private screenMaterial!: THREE.MeshStandardMaterial;

    private moodLights: THREE.PointLight[] = [];
    private barLight!: THREE.PointLight;
    private ambientLight!: THREE.AmbientLight;
    private ceilingLights: THREE.SpotLight[] = [];
    private intercomButton!: THREE.Mesh;

    private state: LimoState;
    private interiorGroup: THREE.Group;

    constructor(
        interiorGroup: THREE.Group,
        initialVehicle: VehicleType,
        initialState: Partial<LimoState> = {},
    ) {
        this.interiorGroup = interiorGroup;
        this.state = { ...defaultLimoState, ...initialState };

        this.root.name = 'limoAtmosphere';
        this.root.position.set(0, 0, ROOT_OFFSET_Z);
        this.root.scale.setScalar(ROOT_SCALE);

        this.createMaterials();
        this.createLighting();
        this.buildPartition();
        this.buildMiniBar();
        this.buildEntertainmentScreens();
        this.buildIntercom();

        this.root.add(this.partitionGroup, this.moodLightsGroup, this.barGroup, this.screensGroup);
        this.attachToCabin();

        this.applyPartitionState();
        this.applyMoodLighting();
        this.applyScreenContent();
        this.setVehicleType(initialVehicle);
    }

    /**
     * Re-parent onto the shared cabin group. `interiorGroup.clear()` (see
     * `rebuildCarInteriorForVehicle`) only detaches children — it doesn't
     * dispose them — so this plugin's own groups survive a vehicle-switch
     * rebuild and just need to be re-added.
     */
    attachToCabin(): void {
        this.interiorGroup.add(this.root);
    }

    setVehicleType(type: VehicleType): void {
        this.root.visible = type === 'limousine';
    }

    private createMaterials(): void {
        const woodCanvas = document.createElement('canvas');
        woodCanvas.width = 256;
        woodCanvas.height = 256;
        const wctx = woodCanvas.getContext('2d');
        if (wctx) {
            wctx.fillStyle = '#3d2817';
            wctx.fillRect(0, 0, 256, 256);
            wctx.strokeStyle = '#2a1a0f';
            wctx.lineWidth = 1;
            for (let i = 0; i < 50; i++) {
                wctx.beginPath();
                wctx.moveTo(0, i * 5 + Math.random() * 3);
                wctx.bezierCurveTo(
                    85, i * 5 + Math.random() * 10,
                    170, i * 5 - Math.random() * 10,
                    256, i * 5 + Math.random() * 5,
                );
                wctx.stroke();
            }
        }
        const woodTexture = new THREE.CanvasTexture(woodCanvas);
        woodTexture.wrapS = THREE.RepeatWrapping;
        woodTexture.wrapT = THREE.RepeatWrapping;

        this.woodMaterial = new THREE.MeshStandardMaterial({
            map: woodTexture,
            color: 0x5c4033,
            roughness: 0.3,
            metalness: 0.0,
        });

        this.chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.1,
            metalness: 0.95,
        });

        this.partitionGlassMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0.0,
            roughness: 0.05,
            transmission: this.state.partitionOpen ? 0.9 : 0.1,
            thickness: 0.02,
            transparent: true,
            opacity: this.state.partitionOpen ? 0.3 : 0.85,
            envMapIntensity: 1.0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
        });

        this.screenMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: 0x001133,
            emissiveIntensity: 0.5,
            roughness: 0.2,
        });
    }

    /** Ceiling spots + mood/bar point lights all ride under `root`, so they inherit the cabin's car-body rotation like the rest of the atmosphere. */
    private createLighting(): void {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        this.root.add(this.ambientLight);

        for (let i = 0; i < 8; i++) {
            const spotLight = new THREE.SpotLight(0xffffee, 0.3, 3, 0.5, 0.5, 1);
            const angle = (i / 8) * Math.PI * 2;
            const radius = 0.5 + Math.random() * 0.3;
            spotLight.position.set(Math.cos(angle) * radius, 1.4, Math.sin(angle) * radius);
            spotLight.target.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            this.ceilingLights.push(spotLight);
            this.root.add(spotLight, spotLight.target);
        }

        const moodColors = [0xff6600, 0x0066ff, 0x6600ff, 0x00ff66];
        const moodPositions: Array<[number, number, number]> = [
            [-0.8, 0.8, 0.4],
            [0.8, 0.8, 0.4],
            [-0.8, 0.8, 1.2],
            [0.8, 0.8, 1.2],
        ];
        moodPositions.forEach((pos, idx) => {
            const light = new THREE.PointLight(moodColors[idx % moodColors.length], 0, 4);
            light.position.set(...pos);
            this.moodLights.push(light);
            this.moodLightsGroup.add(light);
        });

        this.barLight = new THREE.PointLight(0xffaa44, 0.5, 2);
        this.barLight.position.set(0, 1.1, 1.0);
        this.barGroup.add(this.barLight);
    }

    private buildPartition(): void {
        const frameGeo = new THREE.BoxGeometry(1.9, 1.2, 0.08);
        const frame = new THREE.Mesh(frameGeo, this.woodMaterial);
        frame.position.set(0, 0.9, -0.3);
        this.partitionGroup.add(frame);

        const glassGeo = new THREE.PlaneGeometry(1.7, 1.0);
        const glass = new THREE.Mesh(glassGeo, this.partitionGlassMaterial);
        glass.position.set(0, 0.9, -0.26);
        glass.name = 'partitionGlass';
        this.partitionGroup.add(glass);

        const trimGeo = new THREE.BoxGeometry(1.75, 0.05, 0.05);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 1.4, -0.26);
        this.partitionGroup.add(topTrim);

        const bottomTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        bottomTrim.position.set(0, 0.4, -0.26);
        this.partitionGroup.add(bottomTrim);

        const speakerGeo = new THREE.CircleGeometry(0.08, 16);
        const speakerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
        const speaker = new THREE.Mesh(speakerGeo, speakerMat);
        speaker.position.set(0, 0.9, -0.25);
        speaker.rotation.y = Math.PI;
        this.partitionGroup.add(speaker);
    }

    private buildMiniBar(): void {
        const cabinetGeo = new THREE.BoxGeometry(0.5, 0.5, 0.6);
        const cabinet = new THREE.Mesh(cabinetGeo, this.woodMaterial);
        cabinet.position.set(0, 0.6, 0.8);
        this.barGroup.add(cabinet);

        const trimGeo = new THREE.BoxGeometry(0.52, 0.02, 0.62);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 0.86, 0.8);
        this.barGroup.add(topTrim);

        const glassGeo = new THREE.BoxGeometry(0.48, 0.01, 0.58);
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            transmission: 0.9,
            roughness: 0.1,
            thickness: 0.01,
            transparent: true,
            opacity: 0.3,
        });
        const glassTop = new THREE.Mesh(glassGeo, glassMat);
        glassTop.position.set(0, 0.87, 0.8);
        this.barGroup.add(glassTop);

        const decanterPositions: Array<[number, number]> = [[-0.15, 0.7], [0, 0.9], [0.15, 0.7]];
        decanterPositions.forEach(([x, z]) => {
            const bodyGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.12, 8);
            const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffaa33, transmission: 0.8, roughness: 0.1, thickness: 0.02 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.set(x, 0.95, z);
            this.barGroup.add(body);

            const stopperGeo = new THREE.SphereGeometry(0.02, 8, 8);
            const stopper = new THREE.Mesh(stopperGeo, this.chromeMaterial);
            stopper.position.set(x, 1.06, z);
            this.barGroup.add(stopper);
        });

        const bucketGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.1, 12);
        const bucketMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 });
        const bucket = new THREE.Mesh(bucketGeo, bucketMat);
        bucket.position.set(0, 0.92, 0.8);
        this.barGroup.add(bucket);

        const ledGeo = new THREE.BoxGeometry(0.48, 0.005, 0.58);
        const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa44, emissiveIntensity: 0.5 });
        const ledStrip = new THREE.Mesh(ledGeo, ledMat);
        ledStrip.position.set(0, 0.36, 0.8);
        this.barGroup.add(ledStrip);
    }

    private buildEntertainmentScreens(): void {
        const mainScreenGeo = new THREE.PlaneGeometry(0.8, 0.45);
        const mainScreen = new THREE.Mesh(mainScreenGeo, this.screenMaterial.clone());
        mainScreen.position.set(0, 1.1, -0.24);
        mainScreen.rotation.y = Math.PI;
        mainScreen.name = 'mainScreen';
        this.screensGroup.add(mainScreen);

        const bezelGeo = new THREE.BoxGeometry(0.85, 0.5, 0.02);
        const bezelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
        const bezel = new THREE.Mesh(bezelGeo, bezelMat);
        bezel.position.set(0, 1.1, -0.25);
        this.screensGroup.add(bezel);

        const sideScreenPositions: Array<{ x: number; rot: number }> = [
            { x: -0.75, rot: 0.3 },
            { x: 0.75, rot: -0.3 },
        ];
        sideScreenPositions.forEach((pos) => {
            const screenGeo = new THREE.PlaneGeometry(0.3, 0.2);
            const screen = new THREE.Mesh(screenGeo, this.screenMaterial.clone());
            screen.position.set(pos.x, 1.2, 0.5);
            screen.rotation.y = pos.rot;
            screen.name = `sideScreen_${pos.x}`;
            this.screensGroup.add(screen);
        });
    }

    private buildIntercom(): void {
        const panelGeo = new THREE.BoxGeometry(0.15, 0.1, 0.01);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0.85, 1.0, 0.0);
        panel.rotation.y = -0.3;
        this.root.add(panel);

        const buttonGeo = new THREE.CircleGeometry(0.02, 16);
        const buttonMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            emissive: 0x00ff00,
            emissiveIntensity: this.state.intercomActive ? 0.5 : 0,
        });
        this.intercomButton = new THREE.Mesh(buttonGeo, buttonMat);
        this.intercomButton.position.set(0.84, 1.0, 0.01);
        this.intercomButton.rotation.y = -0.3;
        this.intercomButton.name = 'intercomButton';
        this.root.add(this.intercomButton);
    }

    private applyPartitionState(): void {
        applyPartitionGlass(this.partitionGlassMaterial, this.state.partitionOpen);
    }

    private applyMoodLighting(): void {
        applyLimoMoodLighting(this.state, this.moodLights, this.ambientLight, this.barLight);
    }

    private applyScreenContent(): void {
        applyLimoScreenContent(this.screensGroup, this.state);
    }

    togglePartition(): boolean {
        this.state.partitionOpen = !this.state.partitionOpen;
        this.applyPartitionState();
        return this.state.partitionOpen;
    }

    setMoodLighting(mode: LimoState['moodLighting']): void {
        this.state.moodLighting = mode;
        this.applyMoodLighting();
    }

    toggleEntertainment(): boolean {
        this.state.entertainmentOn = !this.state.entertainmentOn;
        this.applyMoodLighting();
        this.applyScreenContent();
        return this.state.entertainmentOn;
    }

    setScreenContent(content: LimoState['screenContent']): void {
        this.state.screenContent = content;
        this.applyScreenContent();
    }

    toggleBarLight(): boolean {
        this.state.barLightOn = !this.state.barLightOn;
        this.applyMoodLighting();
        return this.state.barLightOn;
    }

    toggleIntercom(): boolean {
        this.state.intercomActive = !this.state.intercomActive;
        const mat = this.intercomButton.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = this.state.intercomActive ? 0.5 : 0;
        return this.state.intercomActive;
    }

    getState(): LimoState {
        return { ...this.state };
    }

    update(_deltaTime: number): void {
        tickLimoAtmosphere(this.state, this.moodLights, this.ceilingLights, performance.now() * 0.001);
    }

    dispose(): void {
        this.root.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        this.root.removeFromParent();
    }
}

export default LimoAtmosphere;
