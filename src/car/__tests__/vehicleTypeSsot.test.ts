import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { ConvertibleMode } from '../variants/ConvertibleMode';
import { VEHICLE_LIST, type VehicleType } from '../VehicleManager';

/**
 * `ConvertibleMode` used to declare its own two-value vehicle enum, distinct
 * from `VehicleManager`'s `VehicleType`. Every caller reached it through an
 * `as any` cast, so adding a vehicle to `VehicleManager` could not fail a
 * build here — the cast silently accepted a value the class had never heard of.
 *
 * These tests pin the contract that replaced it: one shared type, and only
 * `'convertible'` is open-air. They exist so a future vehicle either works or
 * fails loudly, rather than being cast into the sedan branch by accident.
 */
function buildMode(): {
    mode: ConvertibleMode;
    roofGroup: THREE.Group;
} {
    const scene = new THREE.Scene();
    const interiorGroup = new THREE.Group();
    const roofGroup = new THREE.Group();
    scene.add(interiorGroup);
    scene.add(roofGroup);
    return { mode: new ConvertibleMode(scene, interiorGroup, roofGroup), roofGroup };
}

describe('VehicleType SSOT — ConvertibleMode accepts VehicleManager types', () => {
    it('accepts every vehicle in VEHICLE_LIST without a cast', () => {
        const { mode } = buildMode();
        // The point of the test is that this loop type-checks: `config.type` is
        // `VehicleType` straight off VehicleManager, passed with no `as any`.
        for (const config of VEHICLE_LIST) {
            expect(() => mode.setVehicleType(config.type)).not.toThrow();
            expect(mode.getVehicleType()).toBe(config.type);
        }
    });

    it("treats only 'convertible' as open-air", () => {
        const { mode, roofGroup } = buildMode();

        mode.setVehicleType('convertible');
        expect(mode.isConvertibleOpen()).toBe(true);
        expect(roofGroup.visible).toBe(false);

        // Every other type — including the two that previously only reached
        // this class through a cast — is a roofed vehicle.
        for (const type of ['sedan', 'science-lab', 'limousine'] as VehicleType[]) {
            mode.setVehicleType(type);
            expect(mode.isConvertibleOpen()).toBe(false);
            expect(roofGroup.visible).toBe(true);
        }
    });

    it('refuses to toggle the roof on a roofed vehicle', () => {
        const { mode } = buildMode();
        for (const type of ['sedan', 'science-lab', 'limousine'] as VehicleType[]) {
            mode.setVehicleType(type);
            expect(mode.toggleRoof()).toBe(false);
        }
        mode.setVehicleType('convertible');
        expect(mode.toggleRoof()).toBe(false); // starts open, first toggle closes
        expect(mode.toggleRoof()).toBe(true);
    });

    it('keeps the pre-existing two-state toggle semantics', () => {
        const { mode } = buildMode();
        // Only 'sedan' toggles *to* convertible; anything else lands on 'sedan'.
        mode.setVehicleType('sedan');
        expect(mode.toggleVehicleType()).toBe('convertible');
        expect(mode.toggleVehicleType()).toBe('sedan');

        mode.setVehicleType('science-lab');
        expect(mode.toggleVehicleType()).toBe('sedan');
    });
});
