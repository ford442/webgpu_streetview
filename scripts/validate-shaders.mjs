#!/usr/bin/env node
/**
 * CI-only WGSL validation via the `naga` CLI (cargo install naga-cli).
 * Catches compile errors that jsdom/Vitest cannot surface without a GPU.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHADERS = [
    'public/shaders/streetview.wgsl',
    'public/shaders/weather-post.wgsl',
    'public/shaders/weather-post-compute.wgsl',
    'public/shaders/weather-particles.wgsl',
    'public/shaders/gpu-chores-hist.wgsl',
    'public/shaders/gpu-chores-downsample.wgsl',
];

function resolveNagaBinary() {
    const fromEnv = process.env.NAGA_BIN;
    if (fromEnv) return fromEnv;
    return 'naga';
}

function validateShader(nagaBin, shaderPath) {
    const abs = path.join(ROOT, shaderPath);
    if (!existsSync(abs)) {
        console.error(`[validate:shaders] missing file: ${shaderPath}`);
        return false;
    }
    const result = spawnSync(nagaBin, [abs], { encoding: 'utf8' });
    if (result.status === 0) {
        console.log(`[validate:shaders] OK ${shaderPath}`);
        return true;
    }
    console.error(`[validate:shaders] FAIL ${shaderPath}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    return false;
}

function nagaAvailable(nagaBin) {
    const probe = spawnSync(nagaBin, ['--version'], { encoding: 'utf8' });
    return probe.status === 0;
}

const expectFailPath = process.argv.find((arg) => arg.startsWith('--expect-fail='))?.split('=')[1];
const nagaBin = resolveNagaBinary();

if (!nagaAvailable(nagaBin)) {
    console.warn(`[validate:shaders] skipped — '${nagaBin}' not found (install: cargo install naga-cli)`);
    process.exit(0);
}

if (expectFailPath) {
    const abs = path.isAbsolute(expectFailPath) ? expectFailPath : path.join(ROOT, expectFailPath);
    const result = spawnSync(nagaBin, [abs], { encoding: 'utf8' });
    if (result.status === 0) {
        console.error(`[validate:shaders] expected failure but shader compiled: ${expectFailPath}`);
        process.exit(1);
    }
    console.log(`[validate:shaders] expected failure confirmed: ${expectFailPath}`);
    process.exit(0);
}

let ok = true;
for (const shader of SHADERS) {
    if (!validateShader(nagaBin, shader)) ok = false;
}
process.exit(ok ? 0 : 1);
