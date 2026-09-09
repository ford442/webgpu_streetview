import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { LimoAtmosphere } from '../limousine/LimoAtmospherePlugin';
import { ScienceLabAtmosphere } from '../scienceLab/ScienceLabAtmosphere';

/**
 * Pins the PR2 fold-in: the limo/lab atmosphere used to live in orphan
 * `LimousineMode` / `ScienceLabInterior` classes that owned a private
 * `THREE.WebGLRenderer` + canvas nothing on the live path ever called (see
 * #239/#236 follow-up). They're now scene plugins — same pattern as
 * `ConvertibleMode` — that share the cabin's `interiorGroup` instead.
 */
describe('car variants — no orphan renderer', () => {
    it('never constructs a THREE.WebGLRenderer under src/car/variants/', () => {
        const variantsDir = path.resolve(__dirname, '..');
        const offenders: string[] = [];

        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
                    const contents = fs.readFileSync(full, 'utf8');
                    if (contents.includes('new THREE.WebGLRenderer')) {
                        offenders.push(path.relative(variantsDir, full));
                    }
                }
            }
        };
        walk(variantsDir);

        expect(offenders).toEqual([]);
    });
});

describe('LimoAtmosphere — scene plugin, not a second cabin', () => {
    it('is only visible for the limousine vehicle type', () => {
        const interiorGroup = new THREE.Group();
        const atmosphere = new LimoAtmosphere(interiorGroup, 'sedan');
        expect(interiorGroup.getObjectByName('limoAtmosphere')?.visible).toBe(false);

        atmosphere.setVehicleType('limousine');
        expect(interiorGroup.getObjectByName('limoAtmosphere')?.visible).toBe(true);

        atmosphere.setVehicleType('science-lab');
        expect(interiorGroup.getObjectByName('limoAtmosphere')?.visible).toBe(false);
    });

    it('survives interiorGroup.clear() by re-attaching, not rebuilding', () => {
        const interiorGroup = new THREE.Group();
        const atmosphere = new LimoAtmosphere(interiorGroup, 'limousine');
        const root = interiorGroup.getObjectByName('limoAtmosphere');
        expect(root).toBeDefined();

        // `rebuildCarInteriorForVehicle` clears interiorGroup on every vehicle switch.
        interiorGroup.clear();
        expect(interiorGroup.getObjectByName('limoAtmosphere')).toBeUndefined();

        atmosphere.attachToCabin();
        // Same object re-parented, not a fresh rebuild.
        expect(interiorGroup.getObjectByName('limoAtmosphere')).toBe(root);
        expect(root?.visible).toBe(true);
    });

    it('toggles partition/mood-lighting/intercom state', () => {
        const atmosphere = new LimoAtmosphere(new THREE.Group(), 'limousine');
        expect(atmosphere.togglePartition()).toBe(true);
        expect(atmosphere.togglePartition()).toBe(false);
        expect(atmosphere.toggleIntercom()).toBe(true);
        atmosphere.setMoodLighting('party');
        expect(atmosphere.getState().moodLighting).toBe('party');
    });
});

describe('ScienceLabAtmosphere — scene plugin, not a second cabin', () => {
    it('is only visible for the science-lab vehicle type', () => {
        const interiorGroup = new THREE.Group();
        const atmosphere = new ScienceLabAtmosphere(interiorGroup);
        atmosphere.setVehicleType('sedan');
        expect(interiorGroup.getObjectByName('scienceLabAtmosphere')?.visible).toBe(false);

        atmosphere.setVehicleType('science-lab');
        expect(interiorGroup.getObjectByName('scienceLabAtmosphere')?.visible).toBe(true);
    });

    it('survives interiorGroup.clear() by re-attaching, not rebuilding', () => {
        const interiorGroup = new THREE.Group();
        const atmosphere = new ScienceLabAtmosphere(interiorGroup);
        const root = interiorGroup.getObjectByName('scienceLabAtmosphere');

        interiorGroup.clear();
        expect(interiorGroup.getObjectByName('scienceLabAtmosphere')).toBeUndefined();

        atmosphere.attachToCabin();
        expect(interiorGroup.getObjectByName('scienceLabAtmosphere')).toBe(root);
    });

    it('toggles UV light and equipment state', () => {
        const atmosphere = new ScienceLabAtmosphere(new THREE.Group());
        expect(atmosphere.toggleUVLight()).toBe(true);
        expect(atmosphere.toggleUVLight()).toBe(false);
        expect(atmosphere.toggleEquipment()).toBe(false);
        expect(atmosphere.getState().equipmentActive).toBe(false);
    });
});
