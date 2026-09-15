import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Isolation guard for the cabin WebGPU default: production `src/car/` must not
 * construct `THREE.ShaderMaterial` (raw GLSL). GLSL twins live in `src/shaders/`;
 * the WebGPU path uses TSL NodeMaterials from the lazy `three/webgpu` chunk.
 * Test stubs may still mention ShaderMaterial.
 */
describe('cabin ShaderMaterial isolation', () => {
    it('does not construct THREE.ShaderMaterial under src/car/ production files', () => {
        const carDir = path.resolve(__dirname, '..');
        const offenders: string[] = [];

        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
                    walk(full);
                } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
                    const contents = fs.readFileSync(full, 'utf8');
                    if (contents.includes('new THREE.ShaderMaterial')) {
                        offenders.push(path.relative(carDir, full));
                    }
                }
            }
        };
        walk(carDir);

        expect(offenders).toEqual([]);
    });
});
