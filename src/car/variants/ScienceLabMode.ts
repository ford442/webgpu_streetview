import * as THREE from 'three';

/**
 * LabState - State tracking for the science lab vehicle
 */
export interface LabState {
    equipmentActive: boolean;
    sampleCount: number;
    dataLogging: boolean;
    uvLightEnabled: boolean;
    instrumentReadings: {
        spectrometer: number;
        phMeter: number;
        temperature: number;
        radiation: number;
    };
}

/**
 * ScienceLabInterior - Mobile research laboratory interior
 * Completely different layout from standard sedan:
 * - Equipment racks instead of passenger seat
 * - Scientific instrument displays
 * - Side-facing bench seats
 * - Lab equipment sounds (fans, beeps)
 * - Special lighting (UV option)
 */
export class ScienceLabInterior {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;

    private labGroup: THREE.Group;
    private equipmentGroup: THREE.Group;
    private instrumentDisplays: THREE.Mesh[] = [];
    private displayMaterials: THREE.MeshStandardMaterial[] = [];
    private uvLight!: THREE.PointLight;
    private taskLights: THREE.PointLight[] = [];
    private equipmentFans: THREE.Group[] = [];
    private sampleDrawers: THREE.Group[] = [];

    // Animation state
    private animationId: number = 0;
    private time: number = 0;
    private fanRotationSpeed: number = 5;
    private blinkTime: number = 0;

    // Lab state
    private labState: LabState = {
        equipmentActive: true,
        sampleCount: 12,
        dataLogging: true,
        uvLightEnabled: false,
        instrumentReadings: {
            spectrometer: 450,
            phMeter: 7.2,
            temperature: 22.5,
            radiation: 0.03
        }
    };

    // Audio context for lab sounds
    private audioContext: AudioContext | null = null;
    private fanOscillator: OscillatorNode | null = null;
    private fanGain: GainNode | null = null;
    private beepOscillator: OscillatorNode | null = null;

    // Materials
    private metalMaterial!: THREE.MeshStandardMaterial;
    private labBenchMaterial!: THREE.MeshStandardMaterial;
    private instrumentMaterial!: THREE.MeshStandardMaterial;
    private whitePlasticMaterial!: THREE.MeshStandardMaterial;
    private darkPlasticMaterial!: THREE.MeshStandardMaterial;
    private glassMaterial!: THREE.MeshStandardMaterial;
    private rubberMatMaterial!: THREE.MeshStandardMaterial;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();

        // Camera position optimized for lab work (slightly higher for better equipment view)
        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.01, 100);
        this.camera.position.set(-0.3, 1.25, 0.0);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.autoClear = false;
        this.canvas = this.renderer.domElement;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '100';
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        container.appendChild(this.canvas);

        this.labGroup = new THREE.Group();
        this.equipmentGroup = new THREE.Group();
        this.scene.add(this.labGroup);
        this.scene.add(this.equipmentGroup);

        this.createMaterials();
        this.createLighting();
        this.buildLabInterior();
        this.initAudio();
    }

    private createMaterials(): void {
        // Brushed metal for equipment frames
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: 0x888899,
            roughness: 0.4,
            metalness: 0.7,
            side: THREE.DoubleSide,
        });

        // Lab bench surface (white composite)
        this.labBenchMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f5f0,
            roughness: 0.3,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        // Instrument panels
        this.instrumentMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a35,
            roughness: 0.5,
            metalness: 0.3,
            side: THREE.DoubleSide,
        });

        // White plastic for equipment housing
        this.whitePlasticMaterial = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.6,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Dark plastic for displays/buttons
        this.darkPlasticMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a20,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        // Glass for sample containers
        this.glassMaterial = new THREE.MeshStandardMaterial({
            color: 0xccddff,
            roughness: 0.1,
            metalness: 0.1,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
        });

        // Rubber mat for work surface
        this.rubberMatMaterial = new THREE.MeshStandardMaterial({
            color: 0x333340,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });
    }

    private createLighting(): void {
        // Ambient lab lighting (cooler white for scientific accuracy)
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        // Overhead fluorescent-style lighting
        const overheadLight1 = new THREE.DirectionalLight(0xfffff0, 0.7);
        overheadLight1.position.set(0, 2.5, 0);
        this.scene.add(overheadLight1);

        // Task lighting above workbench
        const taskLight1 = new THREE.PointLight(0xffffff, 0.5, 4);
        taskLight1.position.set(0.3, 1.8, 0);
        this.taskLights.push(taskLight1);
        this.scene.add(taskLight1);

        const taskLight2 = new THREE.PointLight(0xffffff, 0.4, 3);
        taskLight2.position.set(-0.3, 1.8, 0.5);
        this.taskLights.push(taskLight2);
        this.scene.add(taskLight2);

        // UV light (initially off)
        this.uvLight = new THREE.PointLight(0x6600ff, 0, 5);
        this.uvLight.position.set(0.5, 1.6, 0.3);
        this.scene.add(this.uvLight);

        // Instrument panel glow
        const instrumentGlow = new THREE.PointLight(0x00ff88, 0.3, 2);
        instrumentGlow.position.set(0.3, 1.0, -0.5);
        this.scene.add(instrumentGlow);
    }

    private buildLabInterior(): void {
        this.buildLabFloor();
        this.buildDriverArea();
        this.buildEquipmentRack();
        this.buildBenchSeating();
        this.buildInstrumentDisplays();
        this.buildSampleStorage();
        this.buildRoof();
        this.buildSidePanels();
    }

    private buildLabFloor(): void {
        // Anti-static lab flooring
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        const floor = new THREE.Mesh(floorGeo, this.rubberMatMaterial);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.labGroup.add(floor);

        // Floor-mounted equipment rails
        const railGeo = new THREE.BoxGeometry(1.8, 0.02, 0.05);
        for (let i = 0; i < 4; i++) {
            const rail = new THREE.Mesh(railGeo, this.metalMaterial);
            rail.position.set(0, 0.36, -0.8 + i * 0.6);
            this.labGroup.add(rail);
        }
    }

    private buildDriverArea(): void {
        // Driver seat (more utilitarian than sedan)
        const seatBackGeo = new THREE.BoxGeometry(0.5, 0.65, 0.1);
        const seatBack = new THREE.Mesh(seatBackGeo, this.darkPlasticMaterial);
        seatBack.position.set(-0.35, 0.85, 0.5);
        seatBack.rotation.set(-0.1, 0, 0);
        this.labGroup.add(seatBack);

        const seatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const seatBottom = new THREE.Mesh(seatBottomGeo, this.darkPlasticMaterial);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.labGroup.add(seatBottom);

        // Simplified steering wheel
        const steeringColumnGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8);
        const steeringColumn = new THREE.Mesh(steeringColumnGeo, this.metalMaterial);
        steeringColumn.position.set(-0.35, 0.78, -0.7);
        steeringColumn.rotation.set(Math.PI * 0.35, 0, 0);
        this.labGroup.add(steeringColumn);

        const wheelGeo = new THREE.TorusGeometry(0.16, 0.02, 8, 24);
        const wheel = new THREE.Mesh(wheelGeo, this.darkPlasticMaterial);
        wheel.position.set(-0.35, 0.95, -0.6);
        wheel.rotation.set(Math.PI * 0.35, 0, 0);
        this.labGroup.add(wheel);

        // Driver instrument panel (simplified, scientific style)
        const dashGeo = new THREE.BoxGeometry(0.8, 0.3, 0.4);
        const dash = new THREE.Mesh(dashGeo, this.instrumentMaterial);
        dash.position.set(-0.35, 0.8, -1.0);
        this.labGroup.add(dash);
    }

    private buildEquipmentRack(): void {
        // Main equipment rack (replaces passenger seat)
        const rackFrameGeo = new THREE.BoxGeometry(0.6, 1.2, 0.5);
        const rackFrame = new THREE.Mesh(rackFrameGeo, this.metalMaterial);
        rackFrame.position.set(0.5, 0.95, 0.3);
        this.equipmentGroup.add(rackFrame);

        // Equipment shelves
        for (let i = 0; i < 4; i++) {
            const shelfGeo = new THREE.BoxGeometry(0.55, 0.02, 0.45);
            const shelf = new THREE.Mesh(shelfGeo, this.labBenchMaterial);
            shelf.position.set(0.5, 0.5 + i * 0.28, 0.3);
            this.equipmentGroup.add(shelf);

            // Add equipment units to shelves
            this.addEquipmentToShelf(i, 0.5, 0.5 + i * 0.28, 0.3);
        }

        // Cooling fans on the rack
        for (let i = 0; i < 2; i++) {
            const fanGroup = new THREE.Group();
            fanGroup.position.set(0.5, 1.4 - i * 0.3, 0.56);
            this.equipmentGroup.add(fanGroup);

            // Fan housing
            const housingGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16);
            const housing = new THREE.Mesh(housingGeo, this.darkPlasticMaterial);
            housing.rotation.x = Math.PI / 2;
            fanGroup.add(housing);

            // Fan blades
            const bladeGeo = new THREE.BoxGeometry(0.12, 0.02, 0.01);
            for (let b = 0; b < 4; b++) {
                const blade = new THREE.Mesh(bladeGeo, this.metalMaterial);
                blade.rotation.z = (b * Math.PI) / 2;
                blade.position.z = 0.03;
                fanGroup.add(blade);
            }

            this.equipmentFans.push(fanGroup);
        }

        // Cable management tray
        const cableTrayGeo = new THREE.BoxGeometry(0.5, 0.04, 0.1);
        const cableTray = new THREE.Mesh(cableTrayGeo, this.darkPlasticMaterial);
        cableTray.position.set(0.5, 0.45, 0.55);
        this.equipmentGroup.add(cableTray);
    }

    private addEquipmentToShelf(shelfIndex: number, x: number, y: number, z: number): void {
        switch (shelfIndex) {
            case 0:
                // Spectrometer unit
                const specGeo = new THREE.BoxGeometry(0.2, 0.15, 0.25);
                const spec = new THREE.Mesh(specGeo, this.whitePlasticMaterial);
                spec.position.set(x - 0.1, y + 0.075, z);
                this.equipmentGroup.add(spec);

                // Spectrometer display
                const specDisplayGeo = new THREE.PlaneGeometry(0.15, 0.08);
                const specDisplayMat = new THREE.MeshStandardMaterial({
                    color: 0x000000,
                    emissive: 0x00ff88,
                    emissiveIntensity: 0.4,
                });
                const specDisplay = new THREE.Mesh(specDisplayGeo, specDisplayMat);
                specDisplay.position.set(x - 0.1, y + 0.12, z + 0.13);
                this.equipmentGroup.add(specDisplay);
                break;

            case 1:
                // Centrifuge unit
                const centGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16);
                const cent = new THREE.Mesh(centGeo, this.instrumentMaterial);
                cent.position.set(x, y + 0.1, z);
                this.equipmentGroup.add(cent);

                // Centrifuge lid
                const lidGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16);
                const lid = new THREE.Mesh(lidGeo, this.metalMaterial);
                lid.position.set(x, y + 0.21, z);
                this.equipmentGroup.add(lid);
                break;

            case 2:
                // Sample incubator
                const incGeo = new THREE.BoxGeometry(0.25, 0.18, 0.2);
                const inc = new THREE.Mesh(incGeo, this.whitePlasticMaterial);
                inc.position.set(x, y + 0.09, z);
                this.equipmentGroup.add(inc);

                // Temperature display
                const tempDisplayGeo = new THREE.PlaneGeometry(0.15, 0.06);
                const tempDisplayMat = new THREE.MeshStandardMaterial({
                    color: 0x000000,
                    emissive: 0xff4400,
                    emissiveIntensity: 0.5,
                });
                const tempDisplay = new THREE.Mesh(tempDisplayGeo, tempDisplayMat);
                tempDisplay.position.set(x, y + 0.15, z + 0.11);
                this.equipmentGroup.add(tempDisplay);
                break;

            case 3:
                // pH meter and small instruments
                const phGeo = new THREE.BoxGeometry(0.12, 0.1, 0.15);
                const ph = new THREE.Mesh(phGeo, this.darkPlasticMaterial);
                ph.position.set(x - 0.1, y + 0.05, z);
                this.equipmentGroup.add(ph);

                // Probe
                const probeGeo = new THREE.CylinderGeometry(0.008, 0.005, 0.15, 8);
                const probe = new THREE.Mesh(probeGeo, this.glassMaterial);
                probe.position.set(x - 0.1, y + 0.12, z + 0.05);
                this.equipmentGroup.add(probe);
                break;
        }
    }

    private buildBenchSeating(): void {
        // Left side bench (for lab assistants)
        const leftBenchGeo = new THREE.BoxGeometry(0.4, 0.08, 1.8);
        const leftBench = new THREE.Mesh(leftBenchGeo, this.labBenchMaterial);
        leftBench.position.set(-0.8, 0.55, 0);
        this.labGroup.add(leftBench);

        // Left bench backrest
        const leftBackGeo = new THREE.BoxGeometry(0.08, 0.4, 1.8);
        const leftBack = new THREE.Mesh(leftBackGeo, this.darkPlasticMaterial);
        leftBack.position.set(-0.95, 0.8, 0);
        leftBack.rotation.z = 0.1;
        this.labGroup.add(leftBack);

        // Right side bench (shorter due to equipment rack)
        const rightBenchGeo = new THREE.BoxGeometry(0.4, 0.08, 1.0);
        const rightBench = new THREE.Mesh(rightBenchGeo, this.labBenchMaterial);
        rightBench.position.set(0.9, 0.55, -0.4);
        this.labGroup.add(rightBench);

        // Right bench backrest
        const rightBackGeo = new THREE.BoxGeometry(0.08, 0.4, 1.0);
        const rightBack = new THREE.Mesh(rightBackGeo, this.darkPlasticMaterial);
        rightBack.position.set(1.05, 0.8, -0.4);
        rightBack.rotation.z = -0.1;
        this.labGroup.add(rightBack);

        // Cushions for benches
        for (let i = 0; i < 3; i++) {
            const cushionGeo = new THREE.BoxGeometry(0.35, 0.04, 0.4);
            const cushion = new THREE.Mesh(cushionGeo, this.darkPlasticMaterial);
            cushion.position.set(-0.8, 0.62, -0.6 + i * 0.6);
            this.labGroup.add(cushion);
        }
    }

    private buildInstrumentDisplays(): void {
        // Main instrument panel (above equipment rack)
        const panelGeo = new THREE.BoxGeometry(0.7, 0.25, 0.05);
        const panel = new THREE.Mesh(panelGeo, this.instrumentMaterial);
        panel.position.set(0.5, 1.3, -0.7);
        this.equipmentGroup.add(panel);

        // Create multiple instrument displays
        const displayConfigs = [
            { pos: [0.25, 1.3, -0.67], color: 0x00ff88, label: 'SPEC' },
            { pos: [0.5, 1.3, -0.67], color: 0x0088ff, label: 'DATA' },
            { pos: [0.75, 1.3, -0.67], color: 0xff8800, label: 'TEMP' },
        ];

        displayConfigs.forEach((config, index) => {
            // Display frame
            const frameGeo = new THREE.BoxGeometry(0.18, 0.15, 0.02);
            const frame = new THREE.Mesh(frameGeo, this.darkPlasticMaterial);
            frame.position.set(config.pos[0], config.pos[1], config.pos[2]);
            this.equipmentGroup.add(frame);

            // Display screen
            const screenGeo = new THREE.PlaneGeometry(0.15, 0.12);
            const screenMat = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: config.color,
                emissiveIntensity: 0.3,
            });
            this.displayMaterials.push(screenMat);
            const screen = new THREE.Mesh(screenGeo, screenMat);
            screen.position.set(config.pos[0], config.pos[1], config.pos[2] + 0.02);
            this.equipmentGroup.add(screen);
            this.instrumentDisplays.push(screen);

            // Status LED
            const ledGeo = new THREE.SphereGeometry(0.01, 8, 8);
            const ledMat = new THREE.MeshStandardMaterial({
                color: config.color,
                emissive: config.color,
                emissiveIntensity: 0.8,
            });
            const led = new THREE.Mesh(ledGeo, ledMat);
            led.position.set(config.pos[0] + 0.06, config.pos[1] - 0.06, config.pos[2] + 0.02);
            this.equipmentGroup.add(led);
        });

        // Secondary data panel (on left wall)
        const sidePanelGeo = new THREE.BoxGeometry(0.05, 0.4, 0.6);
        const sidePanel = new THREE.Mesh(sidePanelGeo, this.instrumentMaterial);
        sidePanel.position.set(-0.98, 1.1, 0);
        this.labGroup.add(sidePanel);

        // Side panel displays
        for (let i = 0; i < 2; i++) {
            const sideDisplayGeo = new THREE.PlaneGeometry(0.4, 0.15);
            const sideDisplayMat = new THREE.MeshStandardMaterial({
                color: 0x000000,
                emissive: i === 0 ? 0xff0000 : 0xffff00,
                emissiveIntensity: 0.2,
            });
            const sideDisplay = new THREE.Mesh(sideDisplayGeo, sideDisplayMat);
            sideDisplay.rotation.y = Math.PI / 2;
            sideDisplay.position.set(-0.95, 1.1 + (i === 0 ? 0.1 : -0.1), 0);
            this.labGroup.add(sideDisplay);
        }
    }

    private buildSampleStorage(): void {
        // Sample storage compartments
        for (let i = 0; i < 3; i++) {
            const drawerGroup = new THREE.Group();
            drawerGroup.position.set(-0.6, 0.45 + i * 0.25, -0.8);
            this.labGroup.add(drawerGroup);
            this.sampleDrawers.push(drawerGroup);

            // Drawer housing
            const housingGeo = new THREE.BoxGeometry(0.5, 0.2, 0.3);
            const housing = new THREE.Mesh(housingGeo, this.metalMaterial);
            drawerGroup.add(housing);

            // Drawer front
            const frontGeo = new THREE.BoxGeometry(0.5, 0.18, 0.02);
            const front = new THREE.Mesh(frontGeo, this.whitePlasticMaterial);
            front.position.z = 0.16;
            drawerGroup.add(front);

            // Handle
            const handleGeo = new THREE.BoxGeometry(0.15, 0.02, 0.03);
            const handle = new THREE.Mesh(handleGeo, this.metalMaterial);
            handle.position.set(0, 0, 0.18);
            drawerGroup.add(handle);

            // Label slot
            const labelGeo = new THREE.PlaneGeometry(0.2, 0.08);
            const labelMat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.9,
            });
            const label = new THREE.Mesh(labelGeo, labelMat);
            label.position.set(0, 0.04, 0.17);
            drawerGroup.add(label);
        }

        // Refrigerated sample box
        const fridgeGeo = new THREE.BoxGeometry(0.4, 0.35, 0.4);
        const fridge = new THREE.Mesh(fridgeGeo, this.whitePlasticMaterial);
        fridge.position.set(0.9, 0.525, 0.4);
        this.labGroup.add(fridge);

        // Fridge door
        const fridgeDoorGeo = new THREE.BoxGeometry(0.4, 0.35, 0.03);
        const fridgeDoor = new THREE.Mesh(fridgeDoorGeo, this.labBenchMaterial);
        fridgeDoor.position.set(0.9, 0.525, 0.6);
        this.labGroup.add(fridgeDoor);

        // Handle
        const fridgeHandleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);
        const fridgeHandle = new THREE.Mesh(fridgeHandleGeo, this.metalMaterial);
        fridgeHandle.position.set(0.75, 0.525, 0.62);
        this.labGroup.add(fridgeHandle);

        // Temperature indicator
        const tempIndicatorGeo = new THREE.CircleGeometry(0.03, 16);
        const tempIndicatorMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 0.6,
        });
        const tempIndicator = new THREE.Mesh(tempIndicatorGeo, tempIndicatorMat);
        tempIndicator.position.set(1.05, 0.6, 0.62);
        this.labGroup.add(tempIndicator);
    }

    private buildRoof(): void {
        // Solid roof (no convertible for lab - need controlled environment)
        const roofGeo = new THREE.BoxGeometry(2.0, 0.08, 2.2);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,
            roughness: 0.7,
            side: THREE.DoubleSide,
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 1.65, 0);
        this.labGroup.add(roof);

        // Roof-mounted equipment housing
        const roofEquipGeo = new THREE.BoxGeometry(0.8, 0.1, 0.6);
        const roofEquip = new THREE.Mesh(roofEquipGeo, this.metalMaterial);
        roofEquip.position.set(0.3, 1.75, 0);
        this.labGroup.add(roofEquip);

        // Antenna array
        for (let i = 0; i < 3; i++) {
            const antennaGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8);
            const antenna = new THREE.Mesh(antennaGeo, this.metalMaterial);
            antenna.position.set(0.1 + i * 0.2, 1.9, 0);
            this.labGroup.add(antenna);
        }

        // GPS dome
        const gpsGeo = new THREE.SphereGeometry(0.08, 16, 16);
        const gps = new THREE.Mesh(gpsGeo, this.whitePlasticMaterial);
        gps.position.set(-0.5, 1.75, 0.3);
        this.labGroup.add(gps);
    }

    private buildSidePanels(): void {
        // Left side panel with window
        const leftPanelGeo = new THREE.BoxGeometry(0.05, 1.2, 2.0);
        const leftPanel = new THREE.Mesh(leftPanelGeo, this.instrumentMaterial);
        leftPanel.position.set(-1.0, 1.0, 0);
        this.labGroup.add(leftPanel);

        // Right side panel
        const rightPanelGeo = new THREE.BoxGeometry(0.05, 1.2, 2.0);
        const rightPanel = new THREE.Mesh(rightPanelGeo, this.instrumentMaterial);
        rightPanel.position.set(1.0, 1.0, 0);
        this.labGroup.add(rightPanel);

        // Windshield frame
        const windshieldGeo = new THREE.BoxGeometry(1.9, 0.05, 0.05);
        const windshield = new THREE.Mesh(windshieldGeo, this.metalMaterial);
        windshield.position.set(0, 1.6, -0.9);
        this.labGroup.add(windshield);

        // A-pillars
        const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);
        
        const leftPillar = new THREE.Mesh(pillarGeo, this.metalMaterial);
        leftPillar.position.set(-0.95, 1.3, -0.85);
        leftPillar.rotation.set(-0.2, 0, -0.1);
        this.labGroup.add(leftPillar);

        const rightPillar = new THREE.Mesh(pillarGeo, this.metalMaterial);
        rightPillar.position.set(0.95, 1.3, -0.85);
        rightPillar.rotation.set(-0.2, 0, 0.1);
        this.labGroup.add(rightPillar);
    }

    private initAudio(): void {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.startEquipmentSounds();
        } catch (e) {
            console.warn('Audio not available for lab equipment:', e);
        }
    }

    private startEquipmentSounds(): void {
        if (!this.audioContext) return;

        // Fan drone sound (low frequency)
        this.fanOscillator = this.audioContext.createOscillator();
        this.fanGain = this.audioContext.createGain();
        
        this.fanOscillator.type = 'sawtooth';
        this.fanOscillator.frequency.value = 80;
        this.fanGain.gain.value = 0.03;
        
        // Lowpass filter for fan sound
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 200;
        
        this.fanOscillator.connect(filter);
        filter.connect(this.fanGain);
        this.fanGain.connect(this.audioContext.destination);
        
        this.fanOscillator.start();
    }

    private playBeep(frequency: number = 800, duration: number = 0.1): void {
        if (!this.audioContext) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + duration);
    }

    /**
     * Toggle UV light on/off
     */
    public toggleUVLight(): boolean {
        this.labState.uvLightEnabled = !this.labState.uvLightEnabled;
        this.uvLight.intensity = this.labState.uvLightEnabled ? 0.8 : 0;
        this.playBeep(this.labState.uvLightEnabled ? 1200 : 600, 0.15);
        return this.labState.uvLightEnabled;
    }

    /**
     * Get current UV light state
     */
    public getUVLightState(): boolean {
        return this.labState.uvLightEnabled;
    }

    /**
     * Toggle equipment power
     */
    public toggleEquipment(): boolean {
        this.labState.equipmentActive = !this.labState.equipmentActive;
        this.fanRotationSpeed = this.labState.equipmentActive ? 5 : 0;
        
        // Update audio
        if (this.fanGain) {
            this.fanGain.gain.setTargetAtTime(
                this.labState.equipmentActive ? 0.03 : 0,
                this.audioContext?.currentTime || 0,
                0.5
            );
        }
        
        // Update display intensity
        this.displayMaterials.forEach(mat => {
            mat.emissiveIntensity = this.labState.equipmentActive ? 0.3 : 0.05;
        });
        
        this.playBeep(this.labState.equipmentActive ? 1000 : 500, 0.2);
        return this.labState.equipmentActive;
    }

    /**
     * Get equipment state
     */
    public getEquipmentState(): LabState {
        return { ...this.labState };
    }

    /**
     * Update lab readings
     */
    public updateReadings(readings: Partial<LabState['instrumentReadings']>): void {
        Object.assign(this.labState.instrumentReadings, readings);
    }

    /**
     * Update loop - animate equipment
     */
    public update(deltaTime: number): void {
        this.time += deltaTime;
        this.blinkTime += deltaTime;

        // Animate fans
        this.equipmentFans.forEach((fan, index) => {
            if (this.labState.equipmentActive) {
                fan.children.forEach((child, childIndex) => {
                    if (childIndex > 0) { // Skip housing
                        child.rotation.z += this.fanRotationSpeed * deltaTime * (index % 2 === 0 ? 1 : -1);
                    }
                });
            }
        });

        // Animate instrument displays (blink effect for data logging)
        if (this.labState.equipmentActive && this.labState.dataLogging) {
            const blinkIntensity = 0.3 + Math.sin(this.blinkTime * 4) * 0.1;
            this.displayMaterials.forEach((mat, index) => {
                mat.emissiveIntensity = blinkIntensity + (index * 0.05);
            });
        }

        // Occasional random beeps
        if (this.labState.equipmentActive && Math.random() < 0.001) {
            this.playBeep(600 + Math.random() * 400, 0.05);
        }
    }

    /**
     * Set the lab vehicle orientation
     */
    public setCarOrientation(carHeading: number): void {
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        this.labGroup.rotation.set(0, yawRad, 0);
        this.equipmentGroup.rotation.set(0, yawRad, 0);
    }

    /**
     * Set the head/camera orientation
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));
        
        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);
        
        this.camera.rotation.set(-pitchRad, yawRad, 0);
    }

    /**
     * Render the lab interior
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
        
        // Stop audio
        if (this.fanOscillator) {
            this.fanOscillator.stop();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.renderer.dispose();
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        
        if (this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
    }
}

/**
 * Initialize the science lab mode
 */
export function initScienceLabMode(container: HTMLElement): {
    interior: ScienceLabInterior;
    state: LabState;
} {
    const interior = new ScienceLabInterior(container);
    return {
        interior,
        state: interior.getEquipmentState(),
    };
}

/**
 * ScienceLabMode state container
 */
export interface ScienceLabModeState {
    interior: ScienceLabInterior;
    isActive: boolean;
}

let labModeState: ScienceLabModeState | null = null;
let lastTimestamp = 0;

/**
 * Initialize science lab mode on a container element
 */
export function initScienceLabModeSystem(container: HTMLElement): ScienceLabModeState {
    const interior = new ScienceLabInterior(container);

    labModeState = {
        interior,
        isActive: false,
    };

    return labModeState;
}

/**
 * Toggle science lab mode on/off
 */
export function toggleScienceLabMode(enabled: boolean): void {
    if (!labModeState) return;

    labModeState.isActive = enabled;

    if (labModeState.interior.canvas) {
        labModeState.interior.canvas.style.display = enabled ? 'block' : 'none';
        labModeState.interior.canvas.style.visibility = enabled ? 'visible' : 'hidden';
    }
}

/**
 * Update and render science lab mode
 */
export function updateScienceLabMode(carHeading: number, headYawOffset: number, headPitch: number): void {
    if (!labModeState || !labModeState.isActive) return;

    const now = performance.now();
    const deltaTime = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    labModeState.interior.update(deltaTime);
    labModeState.interior.setCarOrientation(carHeading);
    labModeState.interior.setHeadOrientation(headYawOffset, headPitch);
    labModeState.interior.render();
}

/**
 * Toggle UV light
 */
export function toggleUVLight(): boolean {
    if (!labModeState) return false;
    return labModeState.interior.toggleUVLight();
}

/**
 * Toggle equipment power
 */
export function toggleLabEquipment(): boolean {
    if (!labModeState) return false;
    return labModeState.interior.toggleEquipment();
}

/**
 * Get lab state
 */
export function getLabState(): LabState | null {
    if (!labModeState) return null;
    return labModeState.interior.getEquipmentState();
}

/**
 * Dispose of science lab mode resources
 */
export function disposeScienceLabMode(): void {
    if (!labModeState) return;

    labModeState.interior.dispose();
    labModeState = null;
}
