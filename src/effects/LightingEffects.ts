import * as THREE from 'three';

/**
 * Special lighting effects for science lab vehicle
 * - UV lighting effects
 * - Task lighting
 * - Emergency/flashing lights
 * - Equipment glow effects
 */

export interface LightingEffectConfig {
    uvIntensity: number;
    uvColor: number;
    taskLightIntensity: number;
    emergencyLightEnabled: boolean;
    equipmentGlowIntensity: number;
}

export const DEFAULT_LIGHTING_CONFIG: LightingEffectConfig = {
    uvIntensity: 0.8,
    uvColor: 0x6600ff,
    taskLightIntensity: 0.6,
    emergencyLightEnabled: false,
    equipmentGlowIntensity: 0.4,
};

/**
 * UV Light Effect - creates ultraviolet glow and fluorescence
 */
export class UVLightEffect {
    private light: THREE.PointLight;
    private glowGeometry: THREE.SphereGeometry;
    private glowMaterial: THREE.MeshBasicMaterial;
    private glowMesh: THREE.Mesh;
    private isEnabled: boolean = false;

    constructor(scene: THREE.Scene, position: THREE.Vector3 = new THREE.Vector3(0, 1.6, 0)) {
        // UV light source
        this.light = new THREE.PointLight(0x6600ff, 0, 5);
        this.light.position.copy(position);
        this.light.castShadow = false;
        scene.add(this.light);

        // Visual glow representation
        this.glowGeometry = new THREE.SphereGeometry(0.05, 16, 16);
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x6600ff,
            transparent: true,
            opacity: 0,
        });
        this.glowMesh = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
        this.glowMesh.position.copy(position);
        scene.add(this.glowMesh);
    }

    toggle(): boolean {
        this.isEnabled = !this.isEnabled;
        this.light.intensity = this.isEnabled ? 0.8 : 0;
        this.glowMaterial.opacity = this.isEnabled ? 0.6 : 0;
        return this.isEnabled;
    }

    setIntensity(intensity: number): void {
        if (!this.isEnabled) return;
        this.light.intensity = Math.max(0, Math.min(2, intensity));
    }

    setPosition(position: THREE.Vector3): void {
        this.light.position.copy(position);
        this.glowMesh.position.copy(position);
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.light);
        scene.remove(this.glowMesh);
        this.glowGeometry.dispose();
        this.glowMaterial.dispose();
    }
}

/**
 * Equipment Glow Effect - pulsating glow for active instruments
 */
export class EquipmentGlowEffect {
    private materials: THREE.MeshStandardMaterial[] = [];
    private baseIntensities: number[] = [];
    private pulseSpeed: number = 2;
    private time: number = 0;

    addMaterial(material: THREE.MeshStandardMaterial, baseIntensity: number = 0.2): void {
        this.materials.push(material);
        this.baseIntensities.push(baseIntensity);
    }

    update(deltaTime: number, isActive: boolean): void {
        if (!isActive) {
            // Dim all materials when inactive
            this.materials.forEach((mat, i) => {
                mat.emissiveIntensity = this.baseIntensities[i] * 0.3;
            });
            return;
        }

        this.time += deltaTime;

        // Pulsating effect
        this.materials.forEach((mat, i) => {
            const pulse = Math.sin(this.time * this.pulseSpeed + i * 0.5) * 0.15;
            mat.emissiveIntensity = this.baseIntensities[i] + pulse;
        });
    }

    setPulseSpeed(speed: number): void {
        this.pulseSpeed = speed;
    }

    dispose(): void {
        this.materials = [];
        this.baseIntensities = [];
    }
}

/**
 * Emergency Light Effect - rotating/flashing red lights
 */
export class EmergencyLightEffect {
    private leftLight: THREE.PointLight;
    private rightLight: THREE.PointLight;
    private leftMesh: THREE.Mesh;
    private rightMesh: THREE.Mesh;
    private isEnabled: boolean = false;
    private flashTime: number = 0;
    private flashInterval: number = 0.5;

    constructor(scene: THREE.Scene) {
        // Left emergency light
        this.leftLight = new THREE.PointLight(0xff0000, 0, 4);
        this.leftLight.position.set(-0.8, 1.7, 0.5);
        scene.add(this.leftLight);

        // Right emergency light
        this.rightLight = new THREE.PointLight(0xff0000, 0, 4);
        this.rightLight.position.set(0.8, 1.7, 0.5);
        scene.add(this.rightLight);

        // Visual meshes
        const meshGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8);
        const meshMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

        this.leftMesh = new THREE.Mesh(meshGeo, meshMat.clone());
        this.leftMesh.position.copy(this.leftLight.position);
        scene.add(this.leftMesh);

        this.rightMesh = new THREE.Mesh(meshGeo, meshMat.clone());
        this.rightMesh.position.copy(this.rightLight.position);
        scene.add(this.rightMesh);
    }

    toggle(): boolean {
        this.isEnabled = !this.isEnabled;
        if (!this.isEnabled) {
            this.leftLight.intensity = 0;
            this.rightLight.intensity = 0;
            (this.leftMesh.material as THREE.MeshBasicMaterial).opacity = 0.3;
            (this.rightMesh.material as THREE.MeshBasicMaterial).opacity = 0.3;
        }
        return this.isEnabled;
    }

    update(deltaTime: number): void {
        if (!this.isEnabled) return;

        this.flashTime += deltaTime;
        const flashState = Math.floor(this.flashTime / this.flashInterval) % 2 === 0;

        // Alternate flashing
        this.leftLight.intensity = flashState ? 1.0 : 0;
        this.rightLight.intensity = flashState ? 0 : 1.0;

        (this.leftMesh.material as THREE.MeshBasicMaterial).opacity = flashState ? 1.0 : 0.3;
        (this.rightMesh.material as THREE.MeshBasicMaterial).opacity = flashState ? 0.3 : 1.0;
    }

    setFlashInterval(interval: number): void {
        this.flashInterval = interval;
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.leftLight);
        scene.remove(this.rightLight);
        scene.remove(this.leftMesh);
        scene.remove(this.rightMesh);
        this.leftMesh.geometry.dispose();
        (this.leftMesh.material as THREE.Material).dispose();
        (this.rightMesh.material as THREE.Material).dispose();
    }
}

/**
 * Task Light Effect - focused work lighting
 */
export class TaskLightEffect {
    private light: THREE.SpotLight;
    private target: THREE.Object3D;

    constructor(scene: THREE.Scene, position: THREE.Vector3 = new THREE.Vector3(0, 1.8, 0)) {
        this.light = new THREE.SpotLight(0xfffff0, 0.5, 5, Math.PI / 6, 0.5, 1);
        this.light.position.copy(position);
        this.light.castShadow = true;

        this.target = new THREE.Object3D();
        this.target.position.set(position.x, 0.5, position.z + 0.5);
        this.light.target = this.target;

        scene.add(this.light);
        scene.add(this.target);
    }

    setIntensity(intensity: number): void {
        this.light.intensity = Math.max(0, Math.min(1.5, intensity));
    }

    setTarget(targetPosition: THREE.Vector3): void {
        this.target.position.copy(targetPosition);
    }

    setPosition(position: THREE.Vector3): void {
        this.light.position.copy(position);
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.light);
        scene.remove(this.target);
    }
}

/**
 * Lighting Effects Manager - handles all special lighting
 */
export class LightingEffectsManager {
    private uvEffect: UVLightEffect;
    private equipmentGlow: EquipmentGlowEffect;
    private emergencyLights: EmergencyLightEffect;
    private taskLights: TaskLightEffect[] = [];
    private config: LightingEffectConfig;

    constructor(scene: THREE.Scene, config: Partial<LightingEffectConfig> = {}) {
        this.config = { ...DEFAULT_LIGHTING_CONFIG, ...config };

        this.uvEffect = new UVLightEffect(scene);
        this.equipmentGlow = new EquipmentGlowEffect();
        this.emergencyLights = new EmergencyLightEffect(scene);

        // Create task lights
        const taskLightPositions = [
            new THREE.Vector3(0.3, 1.8, 0),
            new THREE.Vector3(-0.3, 1.8, 0.5),
        ];

        taskLightPositions.forEach(pos => {
            this.taskLights.push(new TaskLightEffect(scene, pos));
        });
    }

    toggleUV(): boolean {
        return this.uvEffect.toggle();
    }

    toggleEmergencyLights(): boolean {
        return this.emergencyLights.toggle();
    }

    setTaskLightIntensity(intensity: number, index?: number): void {
        if (index !== undefined && this.taskLights[index]) {
            this.taskLights[index].setIntensity(intensity);
        } else {
            this.taskLights.forEach(light => light.setIntensity(intensity));
        }
    }

    addEquipmentMaterial(material: THREE.MeshStandardMaterial, baseIntensity?: number): void {
        this.equipmentGlow.addMaterial(material, baseIntensity);
    }

    update(deltaTime: number, equipmentActive: boolean): void {
        this.equipmentGlow.update(deltaTime, equipmentActive);
        this.emergencyLights.update(deltaTime);
    }

    dispose(scene: THREE.Scene): void {
        this.uvEffect.dispose(scene);
        this.equipmentGlow.dispose();
        this.emergencyLights.dispose(scene);
        this.taskLights.forEach(light => light.dispose(scene));
        this.taskLights = [];
    }
}

export default LightingEffectsManager;
