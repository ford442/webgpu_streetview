#!/usr/bin/env node
/**
 * CI-only WGSL validation via the `naga` CLI (cargo install naga-cli).
 * Catches compile errors that jsdom/Vitest cannot surface without a GPU.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    'public/shaders/cabin-composite.wgsl',
    // Subgroup / dual-source variants are assembled at pipeline-create time
    // (`enable subgroups` / `enable dual_source_blending`). naga-cli rejects
    // those enables without extra feature flags — scalar fallbacks above are
    // the naga-clean contract. `gpu-chores-hist-subgroups.wgsl` is loaded only
    // when the device enabled `subgroups`.
];

/**
 * The `aces_tonemap` bodies `src/renderer/shaderFeatureVariants.ts` swaps between
 * when the applied canvas tone mapping is `extended` (`?hdr=1` accepted).
 *
 * Mirrored here rather than imported because this script is plain ESM and the
 * constants live in TypeScript. `src/renderer/shaderFeatureVariants.test.ts`
 * fails if the two ever drift, so this stays a copy, not a second opinion.
 */
export const SDR_ACES_TONEMAP_BODY =
    'fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {\n'
    + '    let a = 2.51;\n'
    + '    let b = 0.03;\n'
    + '    let c = 2.43;\n'
    + '    let d = 0.59;\n'
    + '    let e = 0.14;\n'
    + '    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));\n'
    + '}';

export const EXTENDED_ACES_TONEMAP_BODY =
    'fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {\n'
    + '    // Output-referred variant, assembled only when the applied canvas tone\n'
    + '    // mapping is `extended` (`?hdr=1` on a capable display). The ACES shoulder\n'
    + '    // is evaluated against the display headroom instead of assuming SDR white\n'
    + '    // is the peak, so sun flare / headlights land in the extended range the\n'
    + '    // swap chain can actually show instead of being clamped flat at 1.0.\n'
    + '    // At headroom 1.0 this reduces exactly to the SDR body above.\n'
    + '    let a = 2.51;\n'
    + '    let b = 0.03;\n'
    + '    let c = 2.43;\n'
    + '    let d = 0.59;\n'
    + '    let e = 0.14;\n'
    + '    let headroom = 4.0;\n'
    + '    let x = color / headroom;\n'
    + '    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0)) * headroom;\n'
    + '}';

/**
 * Variants assembled at pipeline-create time that stay free of `enable`
 * directives, so naga can compile them exactly as the device will. (The
 * subgroup / dual-source variants cannot — see the note on SHADERS above.)
 */
const ASSEMBLED_VARIANTS = [
    {
        label: 'weather-post.wgsl (?hdr extended grade)',
        source: 'public/shaders/weather-post.wgsl',
        find: SDR_ACES_TONEMAP_BODY,
        replace: EXTENDED_ACES_TONEMAP_BODY,
    },
    {
        label: 'weather-post-compute.wgsl (?hdr extended grade)',
        source: 'public/shaders/weather-post-compute.wgsl',
        find: SDR_ACES_TONEMAP_BODY,
        replace: EXTENDED_ACES_TONEMAP_BODY,
    },
];

function validateAssembledVariant(nagaBin, variant, outDir) {
    const abs = path.join(ROOT, variant.source);
    if (!existsSync(abs)) {
        console.error(`[validate:shaders] missing file: ${variant.source}`);
        return false;
    }
    const source = readFileSync(abs, 'utf8');
    if (!source.includes(variant.find)) {
        console.error(
            `[validate:shaders] FAIL ${variant.label} — the body it substitutes is no longer in ${variant.source}.`,
        );
        return false;
    }
    const out = path.join(outDir, `${path.basename(variant.source, '.wgsl')}-variant.wgsl`);
    writeFileSync(out, source.replace(variant.find, variant.replace));
    const result = spawnSync(nagaBin, [out], { encoding: 'utf8' });
    if (result.status === 0) {
        console.log(`[validate:shaders] OK ${variant.label}`);
        return true;
    }
    console.error(`[validate:shaders] FAIL ${variant.label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    return false;
}

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

function main() {
    const expectFailPath = process.argv
        .find((arg) => arg.startsWith('--expect-fail='))
        ?.split('=')[1];
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

    const variantDir = mkdtempSync(path.join(tmpdir(), 'wgsl-variants-'));
    for (const variant of ASSEMBLED_VARIANTS) {
        if (!validateAssembledVariant(nagaBin, variant, variantDir)) ok = false;
    }

    process.exit(ok ? 0 : 1);
}

// Importable for the lockstep test above; only the CLI entry point runs naga.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
