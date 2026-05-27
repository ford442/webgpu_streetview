import * as THREE from 'three';
import { LimoState } from './LimousineMode';

export class LimoInteriorBuilder {
    public interiorGroup = new THREE.Group();
    public partitionGroup = new THREE.Group();
    public moodLightsGroup = new THREE.Group();
    public entertainmentGroup = new THREE.Group();
    public barGroup = new THREE.Group();
    public screensGroup = new THREE.Group();

    public luxuryLeatherMaterial!: THREE.MeshStandardMaterial;
    public woodMaterial!: THREE.MeshStandardMaterial;
    public chromeMaterial!: THREE.MeshStandardMaterial;
    public partitionGlassMaterial!: THREE.MeshPhysicalMaterial;
    public screenMaterial!: THREE.MeshStandardMaterial;
    public velvetMaterial!: THREE.MeshStandardMaterial;
    public carpetMaterial!: THREE.MeshStandardMaterial;

    public moodLights: THREE.PointLight[] = [];
    public barLight!: THREE.PointLight;
    public ambientLight!: THREE.AmbientLight;
    public ceilingLights: THREE.SpotLight[] = [];

    constructor(private scene: THREE.Scene, private state: LimoState) {}

    public buildAll(): void {
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
    }

    public createMaterials(): void {
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 256;
        leatherCanvas.height = 256;
        const lctx = leatherCanvas.getContext('2d')!;
        const limg = lctx.createImageData(256, 256);
        for (let i = 0; i < limg.data.length; i += 4) {
            const v = Math.random() * 20 + 35;
            limg.data[i] = v + 40;
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

        const woodCanvas = document.createElement('canvas');
        woodCanvas.width = 256;
        woodCanvas.height = 256;
        const wctx = woodCanvas.getContext('2d')!;
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

        this.velvetMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a0a2e,
            roughness: 0.95,
            metalness: 0.0,
        });

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

    public createLighting(): void {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        this.scene.add(this.ambientLight);

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

        this.barLight = new THREE.PointLight(0xffaa44, 0.5, 2);
        this.barLight.position.set(0, 1.1, 1.8);
        this.barGroup.add(this.barLight);
    }

    public buildInterior(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 4.0);
        const floor = new THREE.Mesh(floorGeo, this.carpetMaterial);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0.5);
        floor.receiveShadow = true;
        this.interiorGroup.add(floor);

        const ceilingGeo = new THREE.PlaneGeometry(1.8, 3.8);
        const ceiling = new THREE.Mesh(ceilingGeo, this.velvetMaterial);
        ceiling.rotation.set(Math.PI / 2, 0, 0);
        ceiling.position.set(0, 1.5, 0.5);
        this.interiorGroup.add(ceiling);

        const leftWallGeo = new THREE.BoxGeometry(0.1, 1.0, 4.0);
        const leftWall = new THREE.Mesh(leftWallGeo, this.woodMaterial);
        leftWall.position.set(-0.95, 0.9, 0.5);
        this.interiorGroup.add(leftWall);

        const rightWallGeo = new THREE.BoxGeometry(0.1, 1.0, 4.0);
        const rightWall = new THREE.Mesh(rightWallGeo, this.woodMaterial);
        rightWall.position.set(0.95, 0.9, 0.5);
        this.interiorGroup.add(rightWall);

        const leftTrimGeo = new THREE.BoxGeometry(0.02, 0.05, 3.8);
        const leftTrim = new THREE.Mesh(leftTrimGeo, this.chromeMaterial);
        leftTrim.position.set(-0.88, 1.2, 0.5);
        this.interiorGroup.add(leftTrim);

        const rightTrimGeo = new THREE.BoxGeometry(0.02, 0.05, 3.8);
        const rightTrim = new THREE.Mesh(rightTrimGeo, this.chromeMaterial);
        rightTrim.position.set(0.88, 1.2, 0.5);
        this.interiorGroup.add(rightTrim);
    }

    public buildPartition(): void {
        const frameGeo = new THREE.BoxGeometry(1.9, 1.2, 0.08);
        const frame = new THREE.Mesh(frameGeo, this.woodMaterial);
        frame.position.set(0, 0.9, -0.5);
        this.partitionGroup.add(frame);

        const glassGeo = new THREE.PlaneGeometry(1.7, 1.0);
        const glass = new THREE.Mesh(glassGeo, this.partitionGlassMaterial);
        glass.position.set(0, 0.9, -0.46);
        glass.name = 'partitionGlass';
        this.partitionGroup.add(glass);

        const trimGeo = new THREE.BoxGeometry(1.75, 0.05, 0.05);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 1.4, -0.46);
        this.partitionGroup.add(topTrim);

        const bottomTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        bottomTrim.position.set(0, 0.4, -0.46);
        this.partitionGroup.add(bottomTrim);

        const speakerGeo = new THREE.CircleGeometry(0.08, 16);
        const speakerMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.9,
        });
        const speaker = new THREE.Mesh(speakerGeo, speakerMat);
        speaker.position.set(0, 0.9, -0.45);
        speaker.rotation.y = Math.PI;
        this.partitionGroup.add(speaker);

        const grillGeo = new THREE.RingGeometry(0.06, 0.08, 16, 4);
        const grill = new THREE.Mesh(grillGeo, this.chromeMaterial);
        grill.position.set(0, 0.9, -0.44);
        grill.rotation.y = Math.PI;
        this.partitionGroup.add(grill);
    }

    public buildRearFacingSeats(): void {
        const seatPositions = [
            { x: -0.45, z: 0 },
            { x: 0.45, z: 0 },
        ];

        seatPositions.forEach((pos) => {
            const backGeo = new THREE.BoxGeometry(0.45, 0.6, 0.08);
            const back = new THREE.Mesh(backGeo, this.luxuryLeatherMaterial);
            back.position.set(pos.x, 0.9, pos.z + 0.25);
            back.rotation.set(-0.15, 0, 0);
            back.castShadow = true;
            this.interiorGroup.add(back);

            const cushionGeo = new THREE.BoxGeometry(0.45, 0.08, 0.4);
            const cushion = new THREE.Mesh(cushionGeo, this.luxuryLeatherMaterial);
            cushion.position.set(pos.x, 0.55, pos.z + 0.05);
            cushion.castShadow = true;
            this.interiorGroup.add(cushion);

            const baseGeo = new THREE.BoxGeometry(0.45, 0.2, 0.4);
            const base = new THREE.Mesh(baseGeo, this.luxuryLeatherMaterial);
            base.position.set(pos.x, 0.45, pos.z + 0.05);
            this.interiorGroup.add(base);

            const headrestGeo = new THREE.BoxGeometry(0.25, 0.2, 0.06);
            const headrest = new THREE.Mesh(headrestGeo, this.luxuryLeatherMaterial);
            headrest.position.set(pos.x, 1.35, pos.z + 0.3);
            headrest.rotation.set(-0.15, 0, 0);
            this.interiorGroup.add(headrest);

            const headrestTrimGeo = new THREE.BoxGeometry(0.27, 0.02, 0.07);
            const headrestTrim = new THREE.Mesh(headrestTrimGeo, this.chromeMaterial);
            headrestTrim.position.set(pos.x, 1.45, pos.z + 0.3);
            headrestTrim.rotation.set(-0.15, 0, 0);
            this.interiorGroup.add(headrestTrim);

            const armrestGeo = new THREE.BoxGeometry(0.15, 0.1, 0.3);
            const armrest = new THREE.Mesh(armrestGeo, this.luxuryLeatherMaterial);
            armrest.position.set(pos.x > 0 ? pos.x - 0.3 : pos.x + 0.3, 0.7, pos.z + 0.1);
            this.interiorGroup.add(armrest);

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

        const forwardPositions = [
            { x: -0.45, z: 2.0 },
            { x: 0.45, z: 2.0 },
        ];

        forwardPositions.forEach((pos) => {
            const backGeo = new THREE.BoxGeometry(0.45, 0.6, 0.08);
            const back = new THREE.Mesh(backGeo, this.luxuryLeatherMaterial);
            back.position.set(pos.x, 0.9, pos.z - 0.25);
            back.rotation.set(0.15, 0, 0);
            back.castShadow = true;
            this.interiorGroup.add(back);

            const cushionGeo = new THREE.BoxGeometry(0.45, 0.08, 0.4);
            const cushion = new THREE.Mesh(cushionGeo, this.luxuryLeatherMaterial);
            cushion.position.set(pos.x, 0.55, pos.z - 0.05);
            cushion.castShadow = true;
            this.interiorGroup.add(cushion);

            const baseGeo = new THREE.BoxGeometry(0.45, 0.2, 0.4);
            const base = new THREE.Mesh(baseGeo, this.luxuryLeatherMaterial);
            base.position.set(pos.x, 0.45, pos.z - 0.05);
            this.interiorGroup.add(base);

            const headrestGeo = new THREE.BoxGeometry(0.25, 0.2, 0.06);
            const headrest = new THREE.Mesh(headrestGeo, this.luxuryLeatherMaterial);
            headrest.position.set(pos.x, 1.35, pos.z - 0.3);
            headrest.rotation.set(0.15, 0, 0);
            this.interiorGroup.add(headrest);
        });
    }

    public buildMiniBar(): void {
        const cabinetGeo = new THREE.BoxGeometry(0.5, 0.5, 0.6);
        const cabinet = new THREE.Mesh(cabinetGeo, this.woodMaterial);
        cabinet.position.set(0, 0.6, 0);
        cabinet.castShadow = true;
        this.barGroup.add(cabinet);

        const trimGeo = new THREE.BoxGeometry(0.52, 0.02, 0.62);
        const topTrim = new THREE.Mesh(trimGeo, this.chromeMaterial);
        topTrim.position.set(0, 0.86, 0);
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
        glassTop.position.set(0, 0.87, 0);
        this.barGroup.add(glassTop);

        const decanterPositions = [
            { x: -0.15, z: -0.1 },
            { x: 0, z: 0.1 },
            { x: 0.15, z: -0.1 },
        ];

        decanterPositions.forEach((pos) => {
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

            const neckGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.04, 8);
            const neck = new THREE.Mesh(neckGeo, bodyMat);
            neck.position.set(pos.x, 1.03, pos.z);
            this.barGroup.add(neck);

            const stopperGeo = new THREE.SphereGeometry(0.02, 8, 8);
            const stopper = new THREE.Mesh(stopperGeo, this.chromeMaterial);
            stopper.position.set(pos.x, 1.06, pos.z);
            this.barGroup.add(stopper);
        });

        const bucketGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.1, 12);
        const bucketMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.3,
            metalness: 0.8,
        });
        const bucket = new THREE.Mesh(bucketGeo, bucketMat);
        bucket.position.set(0, 0.92, 0);
        this.barGroup.add(bucket);

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

        const ledGeo = new THREE.BoxGeometry(0.48, 0.005, 0.58);
        const ledMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffaa44,
            emissiveIntensity: 0.5,
        });
        const ledStrip = new THREE.Mesh(ledGeo, ledMat);
        ledStrip.position.set(0, 0.36, 0);
        this.barGroup.add(ledStrip);

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

    public buildEntertainmentScreens(): void {
        const mainScreenGeo = new THREE.PlaneGeometry(0.8, 0.45);
        const mainScreen = new THREE.Mesh(mainScreenGeo, this.screenMaterial.clone());
        mainScreen.position.set(0, 1.1, -0.44);
        mainScreen.rotation.y = Math.PI;
        mainScreen.name = 'mainScreen';
        this.screensGroup.add(mainScreen);

        const bezelGeo = new THREE.BoxGeometry(0.85, 0.5, 0.02);
        const bezelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.5,
        });
        const bezel = new THREE.Mesh(bezelGeo, bezelMat);
        bezel.position.set(0, 1.1, -0.45);
        this.screensGroup.add(bezel);

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

            const armGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);
            const arm = new THREE.Mesh(armGeo, this.chromeMaterial);
            arm.position.set(pos.x * 0.9, 1.2, 0.45);
            arm.rotation.z = pos.rot > 0 ? -0.5 : 0.5;
            this.screensGroup.add(arm);
        });
    }

    public buildLuxuryDetails(): void {
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

        const readingLightPositions = [
            { x: -0.45, z: 0.2 },
            { x: 0.45, z: 0.2 },
            { x: -0.45, z: 1.8 },
            { x: 0.45, z: 1.8 },
        ];

        readingLightPositions.forEach((pos) => {
            const fixtureGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8);
            const fixture = new THREE.Mesh(fixtureGeo, this.chromeMaterial);
            fixture.position.set(pos.x, 1.48, pos.z);
            this.interiorGroup.add(fixture);

            const glowGeo = new THREE.CircleGeometry(0.025, 8);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xffffee,
            });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.set(pos.x, 1.455, pos.z);
            glow.rotation.x = Math.PI / 2;
            this.interiorGroup.add(glow);

            const spotLight = new THREE.SpotLight(0xffffee, 0.2, 2, 0.5, 0.5, 1);
            spotLight.position.set(pos.x, 1.45, pos.z);
            spotLight.target.position.set(pos.x, 0.5, pos.z + 0.3);
            this.scene.add(spotLight);
            this.scene.add(spotLight.target);
        });

        [-0.9, 0.9].forEach((x) => {
            const handleGeo = new THREE.BoxGeometry(0.08, 0.03, 0.15);
            const handle = new THREE.Mesh(handleGeo, this.chromeMaterial);
            handle.position.set(x, 1.0, 0.5);
            this.interiorGroup.add(handle);

            const recessGeo = new THREE.BoxGeometry(0.01, 0.04, 0.17);
            const recess = new THREE.Mesh(recessGeo, this.woodMaterial);
            recess.position.set(x * 0.98, 1.0, 0.5);
            this.interiorGroup.add(recess);
        });

        [-0.8, 0.8].forEach((x) => {
            const ventGeo = new THREE.BoxGeometry(0.15, 0.03, 0.3);
            const vent = new THREE.Mesh(ventGeo, this.chromeMaterial);
            vent.position.set(x, 1.3, 0.5);
            this.interiorGroup.add(vent);

            for (let i = 0; i < 5; i++) {
                const slatGeo = new THREE.BoxGeometry(0.13, 0.005, 0.01);
                const slat = new THREE.Mesh(slatGeo, this.chromeMaterial);
                slat.position.set(x, 1.3, 0.4 + i * 0.05);
                this.interiorGroup.add(slat);
            }
        });
    }

    public buildWindowLayout(): void {
        const windowFrames = [
            { x: -0.95, z: 1.0, w: 0.08, h: 0.5 },
            { x: 0.95, z: 1.0, w: 0.08, h: 0.5 },
            { x: -0.95, z: 2.0, w: 0.08, h: 0.5 },
            { x: 0.95, z: 2.0, w: 0.08, h: 0.5 },
        ];

        windowFrames.forEach((frame) => {
            const frameGeo = new THREE.BoxGeometry(frame.w, frame.h, 0.06);
            const frameMesh = new THREE.Mesh(frameGeo, this.chromeMaterial);
            frameMesh.position.set(frame.x, 1.0, frame.z);
            this.interiorGroup.add(frameMesh);

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

    public buildIntercom(): void {
        const panelGeo = new THREE.BoxGeometry(0.15, 0.1, 0.01);
        const panelMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.5,
        });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0.85, 1.0, -0.2);
        panel.rotation.y = -0.3;
        this.interiorGroup.add(panel);

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

        const labelGeo = new THREE.PlaneGeometry(0.1, 0.02);
        const labelMat = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
        });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(0.83, 1.03, -0.18);
        label.rotation.y = -0.3;
        this.interiorGroup.add(label);
    }
}
