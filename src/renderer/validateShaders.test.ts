import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveShaderFeatureUses } from './shaderFeatureVariants';

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

    it('keeps shader-f16 out of production WGSL, whatever this naga accepts', () => {
        const probe = spawnSync('naga', ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) {
            return;
        }

        const spikeAccepted = runValidateShaders([
            '--expect-fail=scripts/f16-naga-spike.wgsl',
        ]).status !== 0;

        // naga-cli is installed unpinned in CI, and newer builds accept `f16`
        // where the ones this spike was written against rejected it. Either
        // answer is fine — what must not drift is the shipped state: no
        // production shader enables f16, and the capability matrix says so.
        // Flipping `shaderFeatureUses.shaderF16` needs a production shader that
        // actually uses f16 (see #266), not just a newer validator.
        for (const shader of ['weather-post.wgsl', 'weather-post-compute.wgsl']) {
            const code = readFileSync(path.join(ROOT, 'public', 'shaders', shader), 'utf8');
            expect(code, shader).not.toContain('enable f16;');
        }
        expect(resolveShaderFeatureUses([], 'rgba16float').shaderF16).toBe(false);
        expect(resolveShaderFeatureUses(['shader-f16'], 'rgba16float').shaderF16).toBe(false);

        expect(typeof spikeAccepted).toBe('boolean');
    });
});
