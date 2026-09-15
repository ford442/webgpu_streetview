import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

    it('keeps shader-f16 unused in production WGSL even if naga accepts the toy spike', () => {
        const spike = readFileSync(path.join(ROOT, 'scripts/f16-naga-spike.wgsl'), 'utf8');
        expect(spike).toContain('enable f16;');

        const production = [
            'public/shaders/streetview.wgsl',
            'public/shaders/weather-post.wgsl',
            'public/shaders/weather-post-compute.wgsl',
            'public/shaders/weather-particles.wgsl',
            'public/shaders/gpu-chores-hist.wgsl',
            'public/shaders/gpu-chores-downsample.wgsl',
            'public/shaders/gpu-chores-hist-subgroups.wgsl',
        ];
        for (const rel of production) {
            const src = readFileSync(path.join(ROOT, rel), 'utf8');
            expect(src.includes('enable f16;'), `${rel} must not enable f16`).toBe(false);
        }

        const probe = spawnSync('naga', ['--version'], { encoding: 'utf8' });
        if (probe.status !== 0) {
            return;
        }

        const result = runValidateShaders();
        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).not.toMatch(/f16-naga-spike/);
    });
});
