#!/usr/bin/env node
/**
 * CI-only WGSL validation via the `naga` CLI (cargo install naga-cli).
 * Catches compile errors that jsdom/Vitest cannot surface without a GPU.
 *
 * Validates every file `scripts/gen-shaders.mjs` linked into public/shaders —
 * each entry once per variant (condition subset), exactly the bytes the device
 * receives — plus the WGSL that ships inline in TypeScript.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINKED_DIR = 'public/shaders';

/**
 * `enable` directives naga-cli does not take: it validates subgroup builtins
 * and operations without the directive (its default capabilities), so the
 * variant is checked with the line stripped.
 */
const STRIPPED_ENABLES = ['enable subgroups;'];

/**
 * Linked variants naga cannot validate, and why. Each still compiles on the
 * device (Tint) — the SwiftShader adapter exposes `subgroups` — so a GPU spec
 * or a probe stage covers it; this list only names the naga gaps.
 */
export const NAGA_KNOWN_GAPS = {
    // naga rejects `subgroup_invocation_id` with a multi-dimensional workgroup;
    // the WGSL spec and Tint allow it. Loaded only when the device enabled
    // `subgroups` (GpuChores); the scalar default is validated above.
    'gpu-chores-hist.subgroups.wgsl': 'naga: subgroup_invocation_id needs a 1-D workgroup',
};

/** Every linked shader under public/shaders (all variants), sorted. */
export function linkedShaderFiles(root = ROOT) {
    const dir = path.join(root, LINKED_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.wgsl')).sort();
}

function validateLinked(nagaBin, file, outDir) {
    const label = `${LINKED_DIR}/${file}`;
    let code = readFileSync(path.join(ROOT, LINKED_DIR, file), 'utf8');
    for (const directive of STRIPPED_ENABLES) code = code.replace(new RegExp(`^${directive}$`, 'm'), '');
    const out = path.join(outDir, file);
    writeFileSync(out, code);
    const result = spawnSync(nagaBin, [out], { encoding: 'utf8' });
    if (result.status === 0) {
        if (NAGA_KNOWN_GAPS[file]) {
            console.error(`[validate:shaders] FAIL ${label} — validates now; drop it from NAGA_KNOWN_GAPS`);
            return false;
        }
        console.log(`[validate:shaders] OK ${label}`);
        return true;
    }
    if (NAGA_KNOWN_GAPS[file]) {
        console.log(`[validate:shaders] SKIP ${label} (${NAGA_KNOWN_GAPS[file]})`);
        return true;
    }
    console.error(`[validate:shaders] FAIL ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    return false;
}

/**
 * WGSL that ships inline in TypeScript as a template literal (no `${}`
 * interpolation). The present fallback is the pass that must still compile
 * when a fetched shader does not, so it gets the same naga gate.
 */
export const INLINE_SHADERS = [
    { source: 'src/renderer/PresentFallbackPostProcessor.ts', name: 'PRESENT_FALLBACK_WGSL' },
    { source: 'src/renderer/computeWeather/constants.ts', name: 'BLIT_SHADER' },
];

export function extractInlineWgsl(tsSource, name) {
    const match = new RegExp(`export const ${name} = (?:/\\* wgsl \\*/ )?\`([\\s\\S]*?)\`;`).exec(tsSource);
    if (!match || match[1].includes('${')) return null;
    return match[1];
}

function validateInlineShader(nagaBin, shader, outDir) {
    const label = `${shader.source}#${shader.name}`;
    const abs = path.join(ROOT, shader.source);
    const code = existsSync(abs) ? extractInlineWgsl(readFileSync(abs, 'utf8'), shader.name) : null;
    if (code === null) {
        console.error(`[validate:shaders] FAIL ${label} — not found as a plain template literal`);
        return false;
    }
    const out = path.join(outDir, `${shader.name}.wgsl`);
    writeFileSync(out, code);
    const result = spawnSync(nagaBin, [out], { encoding: 'utf8' });
    if (result.status === 0) {
        console.log(`[validate:shaders] OK ${label}`);
        return true;
    }
    console.error(`[validate:shaders] FAIL ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    return false;
}

function resolveNagaBinary() {
    const fromEnv = process.env.NAGA_BIN;
    if (fromEnv) return fromEnv;
    return 'naga';
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
    const variantDir = mkdtempSync(path.join(tmpdir(), 'wgsl-variants-'));
    const files = linkedShaderFiles();
    if (files.length === 0) {
        console.error(`[validate:shaders] no linked shaders in ${LINKED_DIR} — run \`npm run gen:shaders\``);
        ok = false;
    }
    for (const file of files) {
        if (!validateLinked(nagaBin, file, variantDir)) ok = false;
    }
    for (const shader of INLINE_SHADERS) {
        if (!validateInlineShader(nagaBin, shader, variantDir)) ok = false;
    }

    process.exit(ok ? 0 : 1);
}

// Importable for tests; only the CLI entry point runs naga.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
