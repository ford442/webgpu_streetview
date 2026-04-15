/**
 * LimousineMode.ts - Luxury limousine interior with partition glass, rear-facing seats,
 * mini bar, entertainment screens, and mood lighting system.
 */

import * as THREE from 'three';

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
        
        // Camera positioned for passenger view in the rear cabin
        this.camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.01,
            100
        );
        this.camera.position.set(0, 1.3, 1.5); // Rear passenger position
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency
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

        // Main groups
        this.interiorGroup = new THREE.Group();
        this.partitionGroup = new THREE.Group();
        this.moodLightsGroup = new THREE.Group();
        this.entertainmentGroup = new THREE.Group();
        this.barGroup = new THREE.Group();
        this.screensGroup = new THREE.Group();

        this.scene.add(this.interiorGroup);
        this.scene.add(this.partitionGroup);
        this.scene.add(this.moodLightsGroup);
        this.scene.add(this.entertainmentGroup);
        this.scene.add(this.barGroup);
        this.scene.add(this.screensGroup);

        this.createMaterials();
        this.createLighting();
        this.buildInterior();
        this.buildPartition();
        this.buildRearFacingSeats();
        this.buildMiniBar();
        this.buildEntertainmentScreens();
        this.buildLuxuryDetails();
        this.buildWindowLayout();
        this.buildIntercom();

        // Initialize partition position
        this.updatePartitionPosition();
        this.updateMoodLighting();
    }

    private createMaterials(): void {
        // Luxury leather with subtle grain
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 256;
        leatherCanvas.height = 256;
        const lctx = leatherCanvas.getContext('2d')!;
        const limg = lctx.createImageData(256, 256);
        for (let i = 0; i < limg.data.length; i += 4) {
            const v = Math.random() * 20 + 35;
            limg.data[i] = v + 40;     // Warm brown-red
            limg.data[i + 1] = v + 20;
            limg.data[i + 2] = v;
            limg.data[i + 3] = 255;
        }
        lctx.putImageData(limg, 0, 0);
        const leatherTexture = new THREE.CanvasTexture(leatherCanvas);
        leatherTexture.wrapS = THREE.RepeatWrapping;
        leatherTexture.wrapT = THREE.RepeatWrapping;
        leatherTexture.repeat.set(2, 2);

        this.luxuryLeatherMaterial = new THREE.MeshStandardMaterial({
            map: leatherTexture,
            color: 0x8B4513,
            roughness: 0.6,
            metalness: 0.1,
        });

        // Wood veneer for trim
        const woodCanvas = document.createElement('canvas');
        woodCanvas.width = 256;
        woodCanvas.height = 256;
        const wctx = woodCanvas.getContext('2d')!;
        // Base brown
        wctx.fillStyle = '#3d2817';
        wctx.fillRect(0, 0, 256, 256);
        // Wood grain lines
        wctx.strokeStyle = '#2a1a0f';
        wctx.lineWidth = 1;
        for (let i = 0; i < 50; i++) {
            wctx.beginPath();
            wctx.moveTo(0, i * 5 + Math.random() * 3);
            wctx.bezierCurveTo(
                85, i * 5 + Math.random() * 10,
                170, i * 5 - Math.random() * 10,
                256, i * 5 + Math.random() * 5
            );
            wctx.stroke();
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

        // Chrome/metal accents
        this.chromeMaterial = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.1,
            metalness: 0.95,
        });

        // Privacy partition glass (smart glass effect)
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

        // Screen emissive material
        this.screenMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: 0x001133,
            emissiveIntensity: 0.5,
            roughness: 0.2,
        });

        // Velvet for ceiling
        this.velvetMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a0a2e,
            roughness: 0.95,
            metalness: 0.0,
        });

        // Deep pile carpet
        const carpetCanvas = document.createElement('canvas');
        carpetCanvas.width = 128;
        carpetCanvas.height = 128;
        const cctx = carpetCanvas.getContext('2d')!;
        const cimg = cctx.createImageData(128, 128);
        for (let i = 0; i < cimg.data.length; i += 4) {
            const v = Math.random() * 15 + 20;
            cimg.data[i] = v;
            cimg.data[i + 1] = v + 5;
            cimg.data[i + 2] = v + 10;
            cimg.data[i + 3] = 255;
        }
        cctx.putImageData(cimg, 0, 0);
        const carpetTexture = new THREE.CanvasTexture(carpetCanvas);
        carpetTexture.wrapS = THREE.RepeatWrapping;
        carpetTexture.wrapT = THREE.RepeatWrapping;
        carpetTexture.repeat.set(4, 6);

        this.carpetMaterial = new THREE.MeshStandardMaterial({
            map: carpetTexture,
            color: 0x2d1f3d,
            roughness: 1.0,
            metalness: 0.0,
        });
    }

    private createLighting(): void {
        // Ambient base light
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        this.scene.add(this.ambientLight);

        // Ceiling accent lights (starlight effect)
        for (let i = 0; i < 20; i++) {
            const spotLight = new THREE.SpotLight(0xffffee, 0.3, 3, 0.5, 0.5, 1);
            const angle = (i / 20) * Math.PI * 2;
            const radius = 0.5 + Math.random() * 0.3;
            spotLight.position.set(
                Math.cos(angle) * radius,
                1.4,
                Math.sin(angle) * radius - 0.5
            );
            spotLight.target.position.set(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius - 0.5
            );
            this.ceilingLights.push(spotLight);
            this.scene.add(spotLight);
            this.scene.add(spotLight.target);
        }

        // Mood lighting system - colored accent lights
        const moodColors = [0xff6600, 0x0066ff, 0x6600ff, 0x00ff66];
        const moodPositions = [
            { x: -0.8, y: 0.8, z: 1.0 },
            { x: 0.8, y: 0.8, z: 1.0 },
            { x: -0.8, y: 0.8, z: 2.0 },
            { x: 0.8, y: 0.8, z: 2.0 },
        ];

        moodPositions.forEach((pos, idx) => {
            const light = new THREE.PointLight(moodColors[idx % moodColors.length], 0, 4);
            light.position.set(pos.x, pos.y, pos.z);
            this.moodLights.push(light);
            this.moodLightsGroup.add(light);
        });

        // Bar accent light
        this.barLight = new THREE.PointLight(0xffaa44, 0.5, 2);
        this.barLight.position.set(0, 1.1, 1.8);
        this.barGroup.add(this.barLight);
    }

    private buildInterior(): void {
        // Extended cabin floor (limo is longer)
        const floorGeo = new THREE.PlaneGeometry(2.0, 4.0);
        const floor = new THREE.Mesh(floorGeo, this.carpetMaterial);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0.5);
        floor.receiveShadow = true;
        this.interiorGroup.add(floor);

        // Ceiling with starlight headliner
        const ceilingGeo = new THREE.PlaneGeometry(1.8, 3.8);
        const ceiling = new THREE.Mesh(ceilingGeo, this.velvetMaterial);
        ceiling.rotation.set(Math.PI / 2, 0, 0);
        ceiling.position.set(0, 1.5, 0.5);
        this.interiorGroup.add(ceiling);

        // Side walls with wood trim
        const leftWallGeo = new THREE.BoxGeometry(0.1, 1.0, 4.0);
        const leftWall = new THREE.Mesh(leftWallGeo, this.woodMaterial);
        leftWall.position.set(-0.95, 0.9, 0.5);
        this.interiorGroup.add(leftWall);

        const rightWallGeo = new THREE.BoxGeometry(0.1, 1.0, 4.0);
        const rightWall = new THREE.Mesh(rightWallGeo, this.woodMaterial);
        rightWall.position.set(0.95, 0.9, 0.5);
        this.interiorGroup.add(rightWall);

        // Chrome trim strips
        const leftTrimGeo = new THREE.BoxGeometry(0.02, 0.05, 3.8);
        const leftTrim = new THREE.Mesh(leftTrimGeo, this.chromeMaterial);
        leftTrim.position.set(-0.88, 1.2, 0.5);
        this.interiorGroup.add(leftTrim);

        const rightTrimGeo = new THREE.BoxGeometry(0.02, 0.05, 3.8);
        const rightTrim = new THREE.Mesh(rightTrimGeo, this.chromeMaterial);
        rightTrim.position.set(0.88, 1.2, 0.5);
        this.interiorGroup.add(rightTrim);
    }

    private buildPartition(): void {
        // Privacy partition frame
        const frameGeo = new THREE.BoxGeometry(1.9, 1.2, 0.08);
        const frame = new THREE.Mesh(frameGeo, this.woodMaterial);
        frame.position.set(0, 0.9, -0.5);
        this.partitionGroup.add(frame);

        // Partition glass (toggleable)
        const glassGeo = new THREE.PlaneGeometry(1.7, 1.0);
        const glass = new THREE.Mesh(glassGeo, this.partitionGlassMaterial);
        glass.position.set(0, 0.9, -0.46);
        glass.name = 'partitionGlass';
        this.partitionGroup.add(glass);

        // Chrome trim around glass
        const trimGeo = new THREE.BoxGeometry(1.75, 0.05, 0.05);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 1.4, -0.46);
        this.partitionGroup.add(topTrim);

        const bottomTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        bottomTrim.position.set(0, 0.4, -0.46);
        this.partitionGroup.add(bottomTrim);

        // Intercom speaker grill on partition
        const speakerGeo = new THREE.CircleGeometry(0.08, 16);
        const speakerMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.9,
        });
        const speaker = new THREE.Mesh(speakerGeo, speakerMat);
        speaker.position.set(0, 0.9, -0.45);
        speaker.rotation.y = Math.PI;
        this.partitionGroup.add(speaker);

        // Speaker mesh pattern
        const grillGeo = new THREE.RingGeometry(0.06, 0.08, 16, 4);
        const grill = new THREE.Mesh(grillGeo, this.chromeMaterial);
        grill.position.set(0, 0.9, -0.44);
        grill.rotation.y = Math.PI;
        this.partitionGroup.add(grill);
    }

    private buildRearFacingSeats(): void {
        // Rear-facing seats (toward the back of the limo)
        const seatPositions = [
            { x: -0.45, z: 0 },   // Left rear-facing
            { x: 0.45, z: 0 },    // Right rear-facing
        ];

        seatPositions.forEach((pos) => {
            // Seat back (angled for comfort)
            const backGeo = new THREE.BoxGeometry(0.45, 0.6, 0.08);
            const back = new THREE.Mesh(backGeo, this.luxuryLeatherMaterial);
            back.position.set(pos.x, 0.9, pos.z + 0.25);
            back.rotation.set(-0.15, 0, 0);
            back.castShadow = true;
            this.interiorGroup.add(back);

            // Seat cushion
            const cushionGeo = new THREE.BoxGeometry(0.45, 0.08, 0.4);
            const cushion = new THREE.Mesh(cushionGeo, this.luxuryLeatherMaterial);
            cushion.position.set(pos.x, 0.55, pos.z + 0.05);
            cushion.castShadow = true;
            this.interiorGroup.add(cushion);

            // Seat base
            const baseGeo = new THREE.BoxGeometry(0.45, 0.2, 0.4);
            const base = new THREE.Mesh(baseGeo, this.luxuryLeatherMaterial);
            base.position.set(pos.x, 0.45, pos.z + 0.05);
            this.interiorGroup.add(base);

            // Headrest
            const headrestGeo = new THREE.BoxGeometry(0.25, 0.2, 0.06);
            const headrest = new THREE.Mesh(headrestGeo, this.luxuryLeatherMaterial);
            headrest.position.set(pos.x, 1.35, pos.z + 0.3);
            headrest.rotation.set(-0.15, 0, 0);
            this.interiorGroup.add(headrest);

            // Chrome accent on headrest
            const headrestTrimGeo = new THREE.BoxGeometry(0.27, 0.02, 0.07);
            const headrestTrim = new THREE.Mesh(headrestTrimGeo, this.chromeMaterial);
            headrestTrim.position.set(pos.x, 1.45, pos.z + 0.3);
            headrestTrim.rotation.set(-0.15, 0, 0);
            this.interiorGroup.add(headrestTrim);

            // Armrest with controls
            const armrestGeo = new THREE.BoxGeometry(0.15, 0.1, 0.3);
            const armrest = new THREE.Mesh(armrestGeo, this.luxuryLeatherMaterial);
            armrest.position.set(pos.x > 0 ? pos.x - 0.3 : pos.x + 0.3, 0.7, pos.z + 0.1);
            this.interiorGroup.add(armrest);

            // Control buttons on armrest
            for (let i = 0; i < 3; i++) {
                const buttonGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8);
                const button = new THREE.Mesh(buttonGeo, this.chromeMaterial);
                button.position.set(
                    pos.x > 0 ? pos.x - 0.25 : pos.x + 0.25,
                    0.76,
                    pos.z + 0.05 + i * 0.06
                );
                this.interiorGroup.add(button);
            }
        });

        // Forward-facing seats (for passengers facing each other)
        const forwardPositions = [
            { x: -0.45, z: 2.0 },
            { x: 0.45, z: 2.0 },
        ];

        forwardPositions.forEach((pos) => {
            // Seat back
            const backGeo = new THREE.BoxGeometry(0.45, 0.6, 0.08);
            const back = new THREE.Mesh(backGeo, this.luxuryLeatherMaterial);
            back.position.set(pos.x, 0.9, pos.z - 0.25);
            back.rotation.set(0.15, 0, 0);
            back.castShadow = true;
            this.interiorGroup.add(back);

            // Seat cushion
            const cushionGeo = new THREE.BoxGeometry(0.45, 0.08, 0.4);
            const cushion = new THREE.Mesh(cushionGeo, this.luxuryLeatherMaterial);
            cushion.position.set(pos.x, 0.55, pos.z - 0.05);
            cushion.castShadow = true;
            this.interiorGroup.add(cushion);

            // Seat base
            const baseGeo = new THREE.BoxGeometry(0.45, 0.2, 0.4);
            const base = new THREE.Mesh(baseGeo, this.luxuryLeatherMaterial);
            base.position.set(pos.x, 0.45, pos.z - 0.05);
            this.interiorGroup.add(base);

            // Headrest
            const headrestGeo = new THREE.BoxGeometry(0.25, 0.2, 0.06);
            const headrest = new THREE.Mesh(headrestGeo, this.luxuryLeatherMaterial);
            headrest.position.set(pos.x, 1.35, pos.z - 0.3);
            headrest.rotation.set(0.15, 0, 0);
            this.interiorGroup.add(headrest);
        });
    }

    private buildMiniBar(): void {
        // Bar cabinet between rear-facing seats
        const cabinetGeo = new THREE.BoxGeometry(0.5, 0.5, 0.6);
        const cabinet = new THREE.Mesh(cabinetGeo, this.woodMaterial);
        cabinet.position.set(0, 0.6, 0);
        cabinet.castShadow = true;
        this.barGroup.add(cabinet);

        // Chrome trim
        const trimGeo = new THREE.BoxGeometry(0.52, 0.02, 0.62);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 0.86, 0);
        this.barGroup.add(topTrim);

        // Glass top surface
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
        glassTop.position.set(0, 0.87, 0);
        this.barGroup.add(glassTop);

        // Crystal decanters
        const decanterPositions = [
            { x: -0.15, z: -0.1 },
            { x: 0, z: 0.1 },
            { x: 0.15, z: -0.1 },
        ];

        decanterPositions.forEach((pos) => {
            // Decanter body
            const bodyGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.12, 8);
            const bodyMat = new THREE.MeshPhysicalMaterial({
                color: 0xffaa33,
                transmission: 0.8,
                roughness: 0.1,
                thickness: 0.02,
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.set(pos.x, 0.95, pos.z);
            this.barGroup.add(body);

            // Decanter neck
            const neckGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.04, 8);
            const neck = new THREE.Mesh(neckGeo, bodyMat);
            neck.position.set(pos.x, 1.03, pos.z);
            this.barGroup.add(neck);

            // Stopper
            const stopperGeo = new THREE.SphereGeometry(0.02, 8, 8);
            const stopper = new THREE.Mesh(stopperGeo, this.chromeMaterial);
            stopper.position.set(pos.x, 1.06, pos.z);
            this.barGroup.add(stopper);
        });

        // Champagne bottle in ice bucket
        const bucketGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.1, 12);
        const bucketMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.3,
            metalness: 0.8,
        });
        const bucket = new THREE.Mesh(bucketGeo, bucketMat);
        bucket.position.set(0, 0.92, 0);
        this.barGroup.add(bucket);

        // Bottle
        const bottleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.18, 8);
        const bottleMat = new THREE.MeshPhysicalMaterial({
            color: 0x2d5016,
            roughness: 0.4,
            transmission: 0.4,
        });
        const bottle = new THREE.Mesh(bottleGeo, bottleMat);
        bottle.position.set(0, 1.0, 0);
        bottle.rotation.z = 0.2;
        this.barGroup.add(bottle);

        // LED strip under bar
        const ledGeo = new THREE.BoxGeometry(0.48, 0.005, 0.58);
        const ledMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffaa44,
            emissiveIntensity: 0.5,
        });
        const ledStrip = new THREE.Mesh(ledGeo, ledMat);
        ledStrip.position.set(0, 0.36, 0);
        this.barGroup.add(ledStrip);

        // Glasses rack
        for (let i = 0; i < 4; i++) {
            const glassGeo = new THREE.CylinderGeometry(0.02, 0.015, 0.05, 8);
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                transmission: 0.9,
                roughness: 0.1,
                thickness: 0.005,
            });
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.position.set(-0.18 + i * 0.12, 0.9, -0.2);
            this.barGroup.add(glass);
        }
    }

    private buildEntertainmentScreens(): void {
        // Main screen on partition (facing rear passengers)
        const mainScreenGeo = new THREE.PlaneGeometry(0.8, 0.45);
        const mainScreen = new THREE.Mesh(mainScreenGeo, this.screenMaterial.clone());
        mainScreen.position.set(0, 1.1, -0.44);
        mainScreen.rotation.y = Math.PI;
        mainScreen.name = 'mainScreen';
        this.screensGroup.add(mainScreen);

        // Screen bezel
        const bezelGeo = new THREE.BoxGeometry(0.85, 0.5, 0.02);
        const bezelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.5,
        });
        const bezel = new THREE.Mesh(bezelGeo, bezelMat);
        bezel.position.set(0, 1.1, -0.45);
        this.screensGroup.add(bezel);

        // Side screens for individual passengers
        const sideScreenPositions = [
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

            // Mount arm
            const armGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);
            const arm = new THREE.Mesh(armGeo, this.chromeMaterial);
            arm.position.set(pos.x * 0.9, 1.2, 0.45);
            arm.rotation.z = pos.rot > 0 ? -0.5 : 0.5;
            this.screensGroup.add(arm);
        });

        // Update screen content based on state
        this.updateScreenContent();
    }

    private buildLuxuryDetails(): void {
        // Footrests for each seat
        const footrestPositions = [
            { x: -0.45, z: 0.4 },
            { x: 0.45, z: 0.4 },
            { x: -0.45, z: 1.6 },
            { x: 0.45, z: 1.6 },
        ];

        footrestPositions.forEach((pos) => {
            const restGeo = new THREE.BoxGeometry(0.35, 0.08, 0.25);
            const rest = new THREE.Mesh(restGeo, this.luxuryLeatherMaterial);
            rest.position.set(pos.x, 0.4, pos.z);
            this.interiorGroup.add(rest);
        });

        // Reading lights above each seat
        const readingLightPositions = [
            { x: -0.45, z: 0.2 },
            { x: 0.45, z: 0.2 },
            { x: -0.45, z: 1.8 },
            { x: 0.45, z: 1.8 },
        ];

        readingLightPositions.forEach((pos) => {
            // Light fixture
            const fixtureGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8);
            const fixture = new THREE.Mesh(fixtureGeo, this.chromeMaterial);
            fixture.position.set(pos.x, 1.48, pos.z);
            this.interiorGroup.add(fixture);

            // Light glow
            const glowGeo = new THREE.CircleGeometry(0.025, 8);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xffffee,
            });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.set(pos.x, 1.455, pos.z);
            glow.rotation.x = Math.PI / 2;
            this.interiorGroup.add(glow);

            // Actual light
            const spotLight = new THREE.SpotLight(0xffffee, 0.2, 2, 0.5, 0.5, 1);
            spotLight.position.set(pos.x, 1.45, pos.z);
            spotLight.target.position.set(pos.x, 0.5, pos.z + 0.3);
            this.scene.add(spotLight);
            this.scene.add(spotLight.target);
        });

        // Door handles (luxury style)
        [-0.9, 0.9].forEach((x) => {
            const handleGeo = new THREE.BoxGeometry(0.08, 0.03, 0.15);
            const handle = new THREE.Mesh(handleGeo, this.chromeMaterial);
            handle.position.set(x, 1.0, 0.5);
            this.interiorGroup.add(handle);

            // Handle recess
            const recessGeo = new THREE.BoxGeometry(0.01, 0.04, 0.17);
            const recess = new THREE.Mesh(recessGeo, this.woodMaterial);
            recess.position.set(x * 0.98, 1.0, 0.5);
            this.interiorGroup.add(recess);
        });

        // Climate control vents
        [-0.8, 0.8].forEach((x) => {
            const ventGeo = new THREE.BoxGeometry(0.15, 0.03, 0.3);
            const vent = new THREE.Mesh(ventGeo, this.chromeMaterial);
            vent.position.set(x, 1.3, 0.5);
            this.interiorGroup.add(vent);

            // Vent slats
            for (let i = 0; i < 5; i++) {
                const slatGeo = new THREE.BoxGeometry(0.13, 0.005, 0.01);
                const slat = new THREE.Mesh(slatGeo, this.chromeMaterial);
                slat.position.set(x, 1.3, 0.4 + i * 0.05);
                this.interiorGroup.add(slat);
            }
        });
    }

    private buildWindowLayout(): void {
        // Smaller, more private windows typical of limousines
        const windowFrames = [
            { x: -0.95, z: 1.0, w: 0.08, h: 0.5 },
            { x: 0.95, z: 1.0, w: 0.08, h: 0.5 },
            { x: -0.95, z: 2.0, w: 0.08, h: 0.5 },
            { x: 0.95, z: 2.0, w: 0.08, h: 0.5 },
        ];

        windowFrames.forEach((frame) => {
            // Window frame
            const frameGeo = new THREE.BoxGeometry(frame.w, frame.h, 0.06);
            const frameMesh = new THREE.Mesh(frameGeo, this.chromeMaterial);
            frameMesh.position.set(frame.x, 1.0, frame.z);
            this.interiorGroup.add(frameMesh);

            // Tinted glass
            const glassGeo = new THREE.PlaneGeometry(frame.w - 0.02, frame.h - 0.02);
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0x223344,
                transmission: 0.3,
                roughness: 0.1,
                thickness: 0.01,
                transparent: true,
                opacity: 0.7,
            });
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.position.set(frame.x * 0.99, 1.0, frame.z);
            glass.rotation.y = frame.x > 0 ? Math.PI / 2 : -Math.PI / 2;
            this.interiorGroup.add(glass);

            // Privacy curtain (subtle)
            const curtainGeo = new THREE.PlaneGeometry(0.02, frame.h - 0.05);
            const curtainMat = new THREE.MeshStandardMaterial({
                color: 0x1a0a2e,
                roughness: 0.9,
                side: THREE.DoubleSide,
            });
            const curtain = new THREE.Mesh(curtainGeo, curtainMat);
            curtain.position.set(frame.x * 0.96, 1.0, frame.z);
            curtain.rotation.y = frame.x > 0 ? -Math.PI / 2 : Math.PI / 2;
            this.interiorGroup.add(curtain);
        });
    }

    private buildIntercom(): void {
        // Intercom control panel on the wall
        const panelGeo = new THREE.BoxGeometry(0.15, 0.1, 0.01);
        const panelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.5,
        });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0.85, 1.0, -0.2);
        panel.rotation.y = -0.3;
        this.interiorGroup.add(panel);

        // Intercom button
        const buttonGeo = new THREE.CircleGeometry(0.02, 16);
        const buttonMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            emissive: 0x00ff00,
            emissiveIntensity: this.state.intercomActive ? 0.5 : 0,
        });
        const button = new THREE.Mesh(buttonGeo, buttonMat);
        button.position.set(0.84, 1.0, -0.19);
        button.rotation.y = -0.3;
        button.name = 'intercomButton';
        this.interiorGroup.add(button);

        // Label
        const labelGeo = new THREE.PlaneGeometry(0.1, 0.02);
        const labelMat = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
        });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(0.83, 1.03, -0.18);
        label.rotation.y = -0.3;
        this.interiorGroup.add(label);
    }

    /**
     * Update partition glass opacity based on state
     */
    private updatePartitionPosition(): void {
        this.partitionGlassMaterial.opacity = this.state.partitionOpen ? 0.2 : 0.9;
        this.partitionGlassMaterial.transmission = this.state.partitionOpen ? 0.8 : 0.1;
    }

    /**
     * Update mood lighting colors and intensity
     */
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

        // Update ambient light
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

        // Update bar light
        if (this.state.barLightOn) {
            this.barLight.intensity = 0.5;
        } else {
            this.barLight.intensity = 0;
        }
    }

    /**
     * Update screen content/emissive color
     */
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

    /**
     * Toggle privacy partition open/closed
     */
    public togglePartition(): boolean {
        this.state.partitionOpen = !this.state.partitionOpen;
        this.updatePartitionPosition();
        return this.state.partitionOpen;
    }

    /**
     * Set mood lighting mode
     */
    public setMoodLighting(mode: LimoState['moodLighting']): void {
        this.state.moodLighting = mode;
        this.updateMoodLighting();
    }

    /**
     * Get current mood lighting mode
     */
    public getMoodLighting(): LimoState['moodLighting'] {
        return this.state.moodLighting;
    }

    /**
     * Toggle entertainment system
     */
    public toggleEntertainment(): boolean {
        this.state.entertainmentOn = !this.state.entertainmentOn;
        this.updateMoodLighting();
        this.updateScreenContent();
        return this.state.entertainmentOn;
    }

    /**
     * Set screen content type
     */
    public setScreenContent(content: LimoState['screenContent']): void {
        this.state.screenContent = content;
        this.updateScreenContent();
    }

    /**
     * Toggle bar lighting
     */
    public toggleBarLight(): boolean {
        this.state.barLightOn = !this.state.barLightOn;
        this.updateMoodLighting();
        return this.state.barLightOn;
    }

    /**
     * Toggle intercom system
     */
    public toggleIntercom(): boolean {
        this.state.intercomActive = !this.state.intercomActive;
        // Update intercom button visual
        this.interiorGroup.children.forEach((child) => {
            if (child.name === 'intercomButton') {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = this.state.intercomActive ? 0.5 : 0;
            }
        });
        return this.state.intercomActive;
    }

    /**
     * Toggle chauffeur view (adjusts camera position)
     */
    public toggleChauffeurView(): boolean {
        this.state.chauffeurView = !this.state.chauffeurView;
        if (this.state.chauffeurView) {
            // Move camera forward to see through partition
            this.camera.position.set(0, 1.2, -0.2);
        } else {
            // Return to passenger position
            this.camera.position.set(0, 1.3, 1.5);
        }
        return this.state.chauffeurView;
    }

    /**
     * Get current limousine state
     */
    public getState(): LimoState {
        return { ...this.state };
    }

    /**
     * Set complete state (for restoring from save)
     */
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

    /**
     * Update loop for animations
     */
    public update(deltaTime: number): void {
        // Animate mood lights pulsing
        if (this.state.entertainmentOn && this.state.moodLighting === 'party') {
            const time = performance.now() * 0.001;
            this.moodLights.forEach((light, idx) => {
                const offset = idx * Math.PI / 2;
                light.intensity = 0.5 + Math.sin(time * 2 + offset) * 0.3;
            });
        }

        // Subtle starlight twinkle effect
        this.ceilingLights.forEach((light, idx) => {
            const time = performance.now() * 0.001;
            light.intensity = 0.2 + Math.sin(time * 0.5 + idx) * 0.1;
        });
    }

    /**
     * Set head/camera orientation for looking around
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));
        
        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);
        
        this.camera.rotation.set(-pitchRad, yawRad, 0);
    }

    /**
     * Set car orientation (limo stays level with ground)
     */
    public setCarOrientation(carHeading: number, bodyPitch: number = 0, bodyRoll: number = 0): void {
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        const pitchRad = THREE.MathUtils.degToRad(bodyPitch);
        const rollRad = THREE.MathUtils.degToRad(bodyRoll);
        this.interiorGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.partitionGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.barGroup.rotation.set(pitchRad, yawRad, rollRad);
        this.screensGroup.rotation.set(pitchRad, yawRad, rollRad);
    }

    /**
     * Render the limousine interior
     */
    public render(): void {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize
     */
    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Clean up resources
     */
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

/**
 * Initialize limousine mode on a container element
 */
export function initLimousineMode(
    container: HTMLElement,
    initialState?: Partial<LimoState>
): LimousineMode {
    return new LimousineMode(container, initialState);
}

export default LimousineMode;
