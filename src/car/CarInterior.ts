import * as THREE from 'three';

/**
 * CarInterior - Manages the 3D car interior shell, materials, and roof animation.
 * Uses Three.js primitives to create a low-poly convertible interior from the driver seat perspective.
 * Renders as an overlay with transparent background so the Street View panorama shows through windows.
 */
export class CarInterior {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public canvas: HTMLCanvasElement;

    private interiorGroup: THREE.Group;
    private roofGroup: THREE.Group;
    private steeringWheelGroup!: THREE.Group;
    private leftMirrorPlane!: THREE.Mesh;
    private rightMirrorPlane!: THREE.Mesh;
    private wiperLeft!: THREE.Group;
    private wiperRight!: THREE.Group;
    private speedometerNeedle!: THREE.Mesh;
    private tachometerNeedle!: THREE.Mesh;
    private headlightsLight!: THREE.SpotLight;

    private isRoofOpen: boolean = false;
    private roofTargetY: number = 0;
    private animationId: number = 0;
    private steeringAngle: number = 0;
    private wiperAnimationTime: number = 0;
    private isWiperActive: boolean = false;
    private speedometer: number = 0; // 0-100 km/h
    private tachometer: number = 0; // 0-8000 RPM

    // Materials
    private dashboardMaterial!: THREE.MeshStandardMaterial;
    private leatherMaterial!: THREE.MeshStandardMaterial;
    private metalMaterial!: THREE.MeshStandardMaterial;
    private frameMaterial!: THREE.MeshStandardMaterial;
    private glassMaterial!: THREE.MeshStandardMaterial;
    private mirrorMaterial!: THREE.MeshStandardMaterial;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();

        // Camera at driver seat eye level (~1.2m), slightly angled toward center console
        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.01, 100);
        this.camera.position.set(-0.3, 1.2, 0.0);
        this.camera.rotation.set(0, 0, 0);

        // Renderer with alpha for transparency (Street View shows through)
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // Transparent background
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

        this.interiorGroup = new THREE.Group();
        this.roofGroup = new THREE.Group();
        this.scene.add(this.interiorGroup);
        this.scene.add(this.roofGroup);

        this.createMaterials();
        this.createLighting();
        this.buildInterior();
    }

    private createMaterials(): void {
        // Generate procedural noise texture via canvas for leather roughness
        const leatherCanvas = document.createElement('canvas');
        leatherCanvas.width = 128;
        leatherCanvas.height = 128;
        const ctx = leatherCanvas.getContext('2d')!;
        const imageData = ctx.createImageData(128, 128);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 30 + 40;
            data[i] = v;           // Red
            data[i + 1] = v * 0.8; // Green
            data[i + 2] = v * 0.6; // Blue
            data[i + 3] = 255;     // Alpha
        }
        ctx.putImageData(imageData, 0, 0);
        const leatherTexture = new THREE.CanvasTexture(leatherCanvas);
        leatherTexture.wrapS = THREE.RepeatWrapping;
        leatherTexture.wrapT = THREE.RepeatWrapping;

        // Dashboard plastic material
        this.dashboardMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });

        // Leather material for seats
        this.leatherMaterial = new THREE.MeshStandardMaterial({
            map: leatherTexture,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Metal material for steering column, trim
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.3,
            metalness: 0.8,
            side: THREE.DoubleSide,
        });

        // Frame material for door panels, pillars
        this.frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Glass material for mirrors with mirror-like reflectivity
        this.glassMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.1,
            metalness: 0.95,
            side: THREE.FrontSide,
        });

        // Mirror material (reflective)
        this.mirrorMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.05,
            metalness: 1.0,
            side: THREE.FrontSide,
        });
    }

    private createLighting(): void {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        const dashLight = new THREE.PointLight(0x4CAF50, 0.3, 3);
        dashLight.position.set(0, 0.9, -0.8);
        this.scene.add(dashLight);

        const overhead = new THREE.DirectionalLight(0xffffff, 0.6);
        overhead.position.set(0, 3, 0);
        this.scene.add(overhead);

        // Headlights (toggleable via toggleHeadlights())
        this.headlightsLight = new THREE.SpotLight(0xffffcc, 0.3, 50, 0.5, 1.0, 1.0);
        this.headlightsLight.position.set(0, 0.8, -1.2);
        this.headlightsLight.target.position.set(0, 0, 10);
        this.scene.add(this.headlightsLight);
        this.scene.add(this.headlightsLight.target);
        this.headlightsLight.intensity = 0; // Off by default
    }

    private buildInterior(): void {
        this.buildDashboard();
        this.buildSteeringWheel();
        this.buildDoorPanels();
        this.buildSeats();
        this.buildFloor();
        this.buildRoof();
        this.buildWindshieldFrame();
        this.buildSideMirrors();
        this.buildWipers();
        this.buildGauges();
    }

    private buildDashboard(): void {
        // Main dashboard body
        const dashGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
        const dash = new THREE.Mesh(dashGeo, this.dashboardMaterial);
        dash.position.set(0, 0.8, -1.0);
        this.interiorGroup.add(dash);

        // Dashboard top curve (slightly beveled)
        const dashTopGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8, 1, false, 0, Math.PI);
        const dashTop = new THREE.Mesh(dashTopGeo, this.dashboardMaterial);
        dashTop.rotation.set(0, 0, Math.PI / 2);
        dashTop.position.set(0, 1.0, -0.85);
        this.interiorGroup.add(dashTop);

        // Instrument cluster recess
        const clusterGeo = new THREE.BoxGeometry(0.6, 0.25, 0.05);
        const clusterMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x001100, emissiveIntensity: 0.5 });
        const cluster = new THREE.Mesh(clusterGeo, clusterMat);
        cluster.position.set(-0.3, 0.95, -0.74);
        this.interiorGroup.add(cluster);

        // Center console display
        const displayGeo = new THREE.BoxGeometry(0.3, 0.2, 0.02);
        const displayMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x002200, emissiveIntensity: 0.3 });
        const display = new THREE.Mesh(displayGeo, displayMat);
        display.position.set(0.15, 0.95, -0.74);
        this.interiorGroup.add(display);
    }

    private buildSteeringWheel(): void {
        // Create steering wheel group for rotation animation
        this.steeringWheelGroup = new THREE.Group();
        this.steeringWheelGroup.position.set(-0.35, 0.95, -0.6);
        this.interiorGroup.add(this.steeringWheelGroup);

        // Steering wheel rim (torus)
        const wheelGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 24);
        const wheel = new THREE.Mesh(wheelGeo, this.frameMaterial);
        wheel.rotation.set(Math.PI * 0.35, 0, 0);
        this.steeringWheelGroup.add(wheel);

        // Steering wheel center hub
        const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16);
        const hub = new THREE.Mesh(hubGeo, this.dashboardMaterial);
        hub.rotation.set(Math.PI * 0.35, 0, 0);
        this.steeringWheelGroup.add(hub);

        // Spokes (3 spokes) - attach to rotating wheel
        for (let i = 0; i < 3; i++) {
            const spokeGeo = new THREE.BoxGeometry(0.015, 0.16, 0.015);
            const spoke = new THREE.Mesh(spokeGeo, this.metalMaterial);
            const angle = (i * Math.PI * 2) / 3 + Math.PI * 0.35;
            spoke.position.set(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0);
            spoke.rotation.set(Math.PI * 0.35, 0, angle);
            this.steeringWheelGroup.add(spoke);
        }

        // Steering column (separate from wheel group for aesthetic)
        const columnGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8);
        const column = new THREE.Mesh(columnGeo, this.metalMaterial);
        column.position.set(-0.35, 0.78, -0.7);
        column.rotation.set(Math.PI * 0.35, 0, 0);
        this.interiorGroup.add(column);
    }

    private buildDoorPanels(): void {
        // Left door panel (driver side)
        const leftDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const leftDoor = new THREE.Mesh(leftDoorGeo, this.frameMaterial);
        leftDoor.position.set(-1.0, 0.7, 0.0);
        this.interiorGroup.add(leftDoor);

        // Left door armrest
        const leftArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const leftArm = new THREE.Mesh(leftArmGeo, this.leatherMaterial);
        leftArm.position.set(-0.96, 0.85, 0.1);
        this.interiorGroup.add(leftArm);

        // Right door panel (passenger side)
        const rightDoorGeo = new THREE.BoxGeometry(0.08, 0.6, 1.8);
        const rightDoor = new THREE.Mesh(rightDoorGeo, this.frameMaterial);
        rightDoor.position.set(1.0, 0.7, 0.0);
        this.interiorGroup.add(rightDoor);

        // Right door armrest
        const rightArmGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const rightArm = new THREE.Mesh(rightArmGeo, this.leatherMaterial);
        rightArm.position.set(0.96, 0.85, 0.1);
        this.interiorGroup.add(rightArm);

        // Center console between seats
        const consoleGeo = new THREE.BoxGeometry(0.3, 0.35, 0.8);
        const consoleMesh = new THREE.Mesh(consoleGeo, this.dashboardMaterial);
        consoleMesh.position.set(0.0, 0.55, 0.3);
        this.interiorGroup.add(consoleMesh);
    }

    private buildSeats(): void {
        // Driver seat back
        const seatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const seatBack = new THREE.Mesh(seatBackGeo, this.leatherMaterial);
        seatBack.position.set(-0.35, 0.9, 0.5);
        seatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(seatBack);

        // Driver seat bottom
        const seatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const seatBottom = new THREE.Mesh(seatBottomGeo, this.leatherMaterial);
        seatBottom.position.set(-0.35, 0.5, 0.2);
        this.interiorGroup.add(seatBottom);

        // Passenger seat back
        const passSeatBackGeo = new THREE.BoxGeometry(0.5, 0.7, 0.12);
        const passSeatBack = new THREE.Mesh(passSeatBackGeo, this.leatherMaterial);
        passSeatBack.position.set(0.45, 0.9, 0.5);
        passSeatBack.rotation.set(-0.15, 0, 0);
        this.interiorGroup.add(passSeatBack);

        // Passenger seat bottom
        const passSeatBottomGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
        const passSeatBottom = new THREE.Mesh(passSeatBottomGeo, this.leatherMaterial);
        passSeatBottom.position.set(0.45, 0.5, 0.2);
        this.interiorGroup.add(passSeatBottom);

        // Headrest driver
        const headrestGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrest = new THREE.Mesh(headrestGeo, this.leatherMaterial);
        headrest.position.set(-0.35, 1.35, 0.5);
        this.interiorGroup.add(headrest);

        // Headrest passenger
        const headrestPassGeo = new THREE.BoxGeometry(0.2, 0.2, 0.08);
        const headrestPass = new THREE.Mesh(headrestPassGeo, this.leatherMaterial);
        headrestPass.position.set(0.45, 1.35, 0.5);
        this.interiorGroup.add(headrestPass);
    }

    private buildFloor(): void {
        const floorGeo = new THREE.PlaneGeometry(2.0, 2.5);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.95,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.set(-Math.PI / 2, 0, 0);
        floor.position.set(0, 0.35, 0);
        this.interiorGroup.add(floor);
    }

    private buildRoof(): void {
        // Convertible roof - can be toggled open/closed
        const roofGeo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.9,
            side: THREE.DoubleSide,
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 1.6, 0);
        this.roofGroup.add(roof);
    }

    private buildWindshieldFrame(): void {
        // A-pillars (windshield frame)
        const pillarGeo = new THREE.BoxGeometry(0.06, 0.8, 0.06);

        // Left A-pillar
        const leftPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        leftPillar.position.set(-0.95, 1.3, -0.85);
        leftPillar.rotation.set(-0.2, 0, -0.1);
        this.interiorGroup.add(leftPillar);

        // Right A-pillar
        const rightPillar = new THREE.Mesh(pillarGeo, this.frameMaterial);
        rightPillar.position.set(0.95, 1.3, -0.85);
        rightPillar.rotation.set(-0.2, 0, 0.1);
        this.interiorGroup.add(rightPillar);

        // Windshield top bar
        const topBarGeo = new THREE.BoxGeometry(1.95, 0.06, 0.06);
        const topBar = new THREE.Mesh(topBarGeo, this.frameMaterial);
        topBar.position.set(0, 1.6, -0.9);
        this.interiorGroup.add(topBar);

        // Rearview mirror mount (small bar on windshield top)
        const mirrorMountGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
        const mirrorMount = new THREE.Mesh(mirrorMountGeo, this.metalMaterial);
        mirrorMount.position.set(0, 1.5, -0.85);
        this.interiorGroup.add(mirrorMount);
    }

    private buildSideMirrors(): void {
        // Left side mirror
        const leftMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const leftMirrorFrame = new THREE.Mesh(leftMirrorFrameGeo, this.frameMaterial);
        leftMirrorFrame.position.set(-1.0, 1.05, -0.5);
        leftMirrorFrame.rotation.set(0, 0.3, 0);
        this.interiorGroup.add(leftMirrorFrame);

        const leftMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.leftMirrorPlane = new THREE.Mesh(leftMirrorPlaneGeo, this.mirrorMaterial);
        this.leftMirrorPlane.position.set(-0.98, 1.05, -0.52);
        this.leftMirrorPlane.rotation.set(0, 0.5, 0);
        this.interiorGroup.add(this.leftMirrorPlane);

        // Right side mirror
        const rightMirrorFrameGeo = new THREE.BoxGeometry(0.05, 0.25, 0.08);
        const rightMirrorFrame = new THREE.Mesh(rightMirrorFrameGeo, this.frameMaterial);
        rightMirrorFrame.position.set(1.0, 1.05, -0.5);
        rightMirrorFrame.rotation.set(0, -0.3, 0);
        this.interiorGroup.add(rightMirrorFrame);

        const rightMirrorPlaneGeo = new THREE.PlaneGeometry(0.15, 0.2);
        this.rightMirrorPlane = new THREE.Mesh(rightMirrorPlaneGeo, this.mirrorMaterial);
        this.rightMirrorPlane.position.set(0.98, 1.05, -0.52);
        this.rightMirrorPlane.rotation.set(0, -0.5, 0);
        this.interiorGroup.add(this.rightMirrorPlane);
    }

    private buildWipers(): void {
        // Left wiper (group for animation)
        this.wiperLeft = new THREE.Group();
        this.wiperLeft.position.set(-0.2, 1.4, -0.9);
        this.interiorGroup.add(this.wiperLeft);

        const leftWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const leftWiperBlad = new THREE.Mesh(leftWiperBladGeo, this.metalMaterial);
        leftWiperBlad.position.set(0, -0.15, 0);
        leftWiperBlad.rotation.set(0, 0, -Math.PI / 6);
        this.wiperLeft.add(leftWiperBlad);

        // Right wiper (group for animation)
        this.wiperRight = new THREE.Group();
        this.wiperRight.position.set(0.2, 1.4, -0.9);
        this.interiorGroup.add(this.wiperRight);

        const rightWiperBladGeo = new THREE.BoxGeometry(0.02, 0.3, 0.02);
        const rightWiperBlad = new THREE.Mesh(rightWiperBladGeo, this.metalMaterial);
        rightWiperBlad.position.set(0, -0.15, 0);
        rightWiperBlad.rotation.set(0, 0, Math.PI / 6);
        this.wiperRight.add(rightWiperBlad);
    }

    private buildGauges(): void {
        // Speedometer
        const speedoGeo = new THREE.CircleGeometry(0.15, 32);
        const speedoMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.8,
            emissive: 0x001a00,
            emissiveIntensity: 0.2,
        });
        const speedometer = new THREE.Mesh(speedoGeo, speedoMat);
        speedometer.position.set(-0.5, 0.95, -0.72);
        this.interiorGroup.add(speedometer);

        // Speedometer needle
        const needleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        this.speedometerNeedle = new THREE.Mesh(needleGeo, this.metalMaterial);
        this.speedometerNeedle.position.set(-0.5, 0.98, -0.71);
        this.interiorGroup.add(this.speedometerNeedle);

        // Tachometer
        const tachoGeo = new THREE.CircleGeometry(0.15, 32);
        const tachoMat = new THREE.MeshStandardMaterial({
            color: 0x1a0000,
            roughness: 0.8,
            emissive: 0x330000,
            emissiveIntensity: 0.2,
        });
        const tachometer = new THREE.Mesh(tachoGeo, tachoMat);
        tachometer.position.set(-0.15, 0.95, -0.72);
        this.interiorGroup.add(tachometer);

        // Tachometer needle
        const tachoNeedleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        this.tachometerNeedle = new THREE.Mesh(tachoNeedleGeo, this.metalMaterial);
        this.tachometerNeedle.position.set(-0.15, 0.98, -0.71);
        this.interiorGroup.add(this.tachometerNeedle);
    }

    /**
     * Toggle the convertible roof open/closed.
     * Animates the roof geometry to slide down through the floor.
     */
    public toggleRoof(): void {
        this.isRoofOpen = !this.isRoofOpen;
        this.roofTargetY = this.isRoofOpen ? -1.0 : 1.6;
    }

    /**
     * Update loop - call each frame to animate roof, steering wheel, wipers, and gauges.
     */
    public update(deltaTime: number): void {
        // Animate roof position (lerp)
        const currentY = this.roofGroup.position.y;
        const targetY = this.roofTargetY;
        const diff = targetY - currentY;
        if (Math.abs(diff) > 0.001) {
            this.roofGroup.position.y += diff * Math.min(deltaTime * 3, 1);
        }

        // Smooth steering wheel rotation (lerp to target)
        if (this.steeringWheelGroup) {
            const targetAngle = this.steeringAngle;
            const diff = targetAngle - this.steeringWheelGroup.rotation.z;
            // Handle angle wrapping
            let shortestDiff = diff;
            if (shortestDiff > Math.PI) shortestDiff -= Math.PI * 2;
            if (shortestDiff < -Math.PI) shortestDiff += Math.PI * 2;
            this.steeringWheelGroup.rotation.z += shortestDiff * Math.min(deltaTime * 5, 1);
        }

        // Animate wipers
        if (this.isWiperActive) {
            this.wiperAnimationTime += deltaTime;
            const wiperCycle = this.wiperAnimationTime % 1.0; // 1 second cycle
            const wiperAngle = Math.sin(wiperCycle * Math.PI) * (Math.PI / 4); // Sweep ±45°
            if (this.wiperLeft) {
                this.wiperLeft.rotation.z = -wiperAngle - Math.PI / 6;
            }
            if (this.wiperRight) {
                this.wiperRight.rotation.z = wiperAngle + Math.PI / 6;
            }
        }

        // Update gauge needles
        this.updateGaugles();
    }

    /**
     * Update gauge needle positions based on speed/RPM.
     * Speed: 0-100 km/h maps to gauge rotation
     * RPM: 0-8000 maps to gauge rotation
     */
    private updateGaugles(): void {
        if (this.speedometerNeedle) {
            // Speedometer: 0-300° rotation (0-100 km/h)
            const speedAngle = THREE.MathUtils.degToRad((this.speedometer / 100) * 300 - 150);
            this.speedometerNeedle.rotation.z = speedAngle;
        }

        if (this.tachometerNeedle) {
            // Tachometer: 0-300° rotation (0-8000 RPM)
            const tachoAngle = THREE.MathUtils.degToRad((this.tachometer / 8000) * 300 - 150);
            this.tachometerNeedle.rotation.z = tachoAngle;
        }
    }

    /**
     * Set the car body orientation (carHeading).
     * The interior stays level with the ground while the head can look freely.
     * @param carHeading - The car's travel direction in degrees
     */
    public setCarOrientation(carHeading: number): void {
        // Car body stays level with ground - no pitch or roll, just yaw
        // Convert heading to radians (negative for Three.js coordinate system)
        const yawRad = -THREE.MathUtils.degToRad(carHeading);
        this.interiorGroup.rotation.set(0, yawRad, 0);
    }

    /**
     * Set the head/camera orientation for looking around inside the car.
     * This only affects the camera, not the car body.
     * @param headYaw - Yaw angle in degrees (-110 to +110)
     * @param headPitch - Pitch angle in degrees (-45 to +65)
     */
    public setHeadOrientation(headYaw: number, headPitch: number): void {
        // Clamp to realistic head movement ranges
        const clampedYaw = Math.max(-110, Math.min(110, headYaw));
        const clampedPitch = Math.max(-45, Math.min(65, headPitch));
        
        const yawRad = THREE.MathUtils.degToRad(clampedYaw);
        const pitchRad = THREE.MathUtils.degToRad(clampedPitch);
        
        // Apply rotation to camera (looking up = negative pitch in Three.js)
        // Yaw is rotation around Y axis, pitch is rotation around X axis
        this.camera.rotation.set(-pitchRad, yawRad, 0);
    }

    /**
     * Set the steering wheel angle based on car steering input.
     * @param angle - Steering angle in degrees (-90 to +90)
     */
    public setSteeringAngle(angle: number): void {
        // Clamp to reasonable steering range
        this.steeringAngle = THREE.MathUtils.degToRad(Math.max(-90, Math.min(90, angle)));
    }

    /**
     * Set the active wiper state.
     */
    public setWipersActive(active: boolean): void {
        this.isWiperActive = active;
        if (!active) {
            // Reset wipers to rest position
            this.wiperAnimationTime = 0;
            if (this.wiperLeft) this.wiperLeft.rotation.z = -Math.PI / 6;
            if (this.wiperRight) this.wiperRight.rotation.z = Math.PI / 6;
        }
    }

    /**
     * Update speedometer and tachometer values.
     * @param speed - Speed in km/h (0-100)
     * @param rpm - RPM (0-8000)
     */
    public setGaugeValues(speed: number, rpm: number): void {
        this.speedometer = Math.max(0, Math.min(100, speed));
        this.tachometer = Math.max(0, Math.min(8000, rpm));
    }

    /**
     * Toggle headlights on/off.
     */
    public toggleHeadlights(): void {
        if (this.headlightsLight) {
            this.headlightsLight.intensity = this.headlightsLight.intensity > 0 ? 0 : 0.5;
        }
    }

    /**
     * Get current headlights state.
     */
    public getHeadlightsState(): boolean {
        return this.headlightsLight ? this.headlightsLight.intensity > 0 : false;
    }

    /**
     * Test whether the given screen coordinates intersect the steering wheel geometry.
     * Used to detect when the user clicks on the steering wheel for car-steering drag.
     * @param clientX - Mouse clientX from a DOM MouseEvent
     * @param clientY - Mouse clientY from a DOM MouseEvent
     * @returns true if the ray from the camera hits the steering wheel group
     */
    public isSteeringWheelHit(clientX: number, clientY: number): boolean {
        if (!this.steeringWheelGroup) return false;
        const rect = this.canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        // Ensure world matrices are current before testing
        this.steeringWheelGroup.updateWorldMatrix(true, true);
        const intersects = raycaster.intersectObject(this.steeringWheelGroup, true);
        return intersects.length > 0;
    }

    /**
     * Render the car interior scene.
     */
    public render(): void {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize.
     */
    public resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Clean up resources.
     */
    public dispose(): void {
        cancelAnimationFrame(this.animationId);
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
