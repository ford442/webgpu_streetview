import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function runValidateShaders(args: string[] = []) {
    return spawnSync(process.execPath, ['scripts/validate-shaders.mjs', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

describe('validate:shaders script', () => {
    it('fails on intentionally broken WGSL when naga is available', () => {
        const probe = spawnSync('naga', ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) {
            return;
        }

        const result = runValidateShaders([
            '--expect-fail=scripts/fixtures/invalid-shader.wgsl',
        ]);
        expect(result.status).toBe(0);
    });

    it('validates production WGSL when naga is available', () => {
        const probe = spawnSync('naga', ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) {
            return;
        }

        const result = runValidateShaders();
        expect(result.status).toBe(0);
    });

    it('documents that production f16 is rejected when naga is available', () => {
        const probe = spawnSync('naga', ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) {
            return;
        }

        const result = runValidateShaders(['--expect-fail=scripts/f16-naga-spike.wgsl']);
        // If this starts failing because naga accepted the spike, shader-f16
        // may be ready to ship — do not flip shaderFeatureUses.shaderF16 without
        // a naga-clean production shader.
        expect(result.status).toBe(0);
    });
});
