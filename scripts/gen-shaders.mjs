#!/usr/bin/env node
/**
 * scripts/gen-shaders.mjs
 *
 * src/shaders/**\/*.wesl → public/shaders/*.wgsl. The WESL sources are the
 * shader source of truth: shared helpers (noise, scene depth, horizon,
 * semantic, grade, the weather effects) live once under `lib/` and `weather/`
 * and are `import`ed; variants are `@if` conditions. This script links each
 * entry of `src/shaders/shaders.manifest.json` once per subset of its
 * `conditions` with the `wesl` linker (a dev dependency — nothing links at
 * runtime, and no linker code ships in any chunk), and writes plain WGSL that
 * the renderer fetches by name and the service worker precaches
 * (scripts/sw-manifest.mjs hashes it into the cache id).
 *
 *   npm run gen:shaders                   # rewrite public/shaders/*.wgsl
 *   node scripts/gen-shaders.mjs --check  # exit 1 when any of them is stale
 *
 * The linked files are committed so a shader change is a reviewable diff.
 * `--check` runs in `npm run verify` (and CI); hand-edits to public/shaders
 * fail it. Variant file names: `<entry>[.<condition>...].wgsl`, conditions in
 * manifest order (`linkedShaderFile` in src/renderer/shaderFeatureVariants.ts).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { link } from 'wesl/core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WESL_ROOT = 'src/shaders';
export const SHADER_MANIFEST = 'src/shaders/shaders.manifest.json';
export const LINKED_DIR = 'public/shaders';

/**
 * Attributes the linker must carry through. `wesl` drops an attribute it does
 * not know without a word (it ate the pre-spec `@second_blend_source`), so any
 * attribute used in a source and missing from every output fails the run.
 */
const CONDITION_ATTRIBUTES = new Set(['if', 'elif', 'else']);

/**
 * @param {string} dir
 * @param {string} [rel]
 * @returns {string[]}
 */
function walk(dir, rel = '') {
    /** @type {string[]} */
    const out = [];
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...walk(dir, next));
        else out.push(next);
    }
    return out;
}

/** Every `.wesl` under src/shaders, keyed by its path relative to that root. */
export function readWeslSources(root = repoRoot) {
    const dir = join(root, WESL_ROOT);
    /** @type {Record<string, string>} */
    const sources = {};
    for (const file of walk(dir).filter((/** @type {string} */ f) => f.endsWith('.wesl')).sort()) {
        sources[file] = readFileSync(join(dir, file), 'utf8');
    }
    return sources;
}

/** @returns {Record<string, { conditions?: string[], fixed?: Record<string, boolean> }>} */
export function readShaderManifest(root = repoRoot) {
    return JSON.parse(readFileSync(join(root, SHADER_MANIFEST), 'utf8')).entries;
}

/**
 * All subsets of `conditions`, in manifest order, the empty one (the default variant) first.
 * @param {string[]} [conditions]
 * @returns {string[][]}
 */
export function conditionSubsets(conditions = []) {
    /** @type {string[][]} */
    const subsets = [];
    for (let mask = 0; mask < 1 << conditions.length; mask += 1) {
        subsets.push(conditions.filter((_, i) => (mask >> i) & 1));
    }
    return subsets;
}

/**
 * `weather-post` + [`dual_source`, `hdr_grade`] → `weather-post.dual_source.hdr_grade.wgsl`.
 * @param {string} entry
 * @param {string[]} [enabled]
 */
export function linkedFileName(entry, enabled = []) {
    return [entry, ...enabled].join('.') + '.wgsl';
}

/**
 * The attribute names used in `code` (comments ignored).
 * @param {string} code
 */
function attributeNames(code) {
    /** @type {Set<string>} */
    const names = new Set();
    for (const m of code.replace(/\/\/.*$/gm, '').matchAll(/@([A-Za-z_]\w*)/g)) {
        const name = m[1] ?? '';
        if (!CONDITION_ATTRIBUTES.has(name)) names.add(name);
    }
    return names;
}

/** @param {string} wgsl */
function tidy(wgsl) {
    return wgsl.replace(/^\s+/, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
}

/**
 * Link one variant of one entry to WGSL (with the generated-file banner).
 * @param {string} entry
 * @param {string[]} enabled conditions switched on; every other manifest condition is off
 */
export async function linkShader(entry, enabled = [], { sources = readWeslSources(), manifest = readShaderManifest() } = {}) {
    const spec = manifest[entry];
    if (!spec) throw new Error(`gen-shaders: "${entry}" is not in ${SHADER_MANIFEST}`);
    /** @type {Record<string, boolean>} */
    const conditions = { ...(spec.fixed ?? {}) };
    for (const c of spec.conditions ?? []) conditions[c] = enabled.includes(c);
    for (const c of enabled) {
        if (!(spec.conditions ?? []).includes(c)) throw new Error(`gen-shaders: ${entry} has no condition "${c}"`);
    }
    const linked = await link({
        weslSrc: sources,
        rootModuleName: `${entry}.wesl`,
        conditions,
        sourceMap: false,
    });
    const variant = enabled.length ? enabled.join(' + ') : 'default';
    const banner = `// GENERATED by scripts/gen-shaders.mjs from ${WESL_ROOT}/${entry}.wesl (${variant}).\n`
        + '// Do not edit: change the .wesl sources and run `npm run gen:shaders`.\n\n';
    return banner + tidy(linked.dest);
}

/** Every linked file: { file, entry, enabled, code }. */
export async function linkAll(root = repoRoot) {
    const sources = readWeslSources(root);
    const manifest = readShaderManifest(root);
    for (const entry of Object.keys(manifest)) {
        if (!(`${entry}.wesl` in sources)) throw new Error(`gen-shaders: ${WESL_ROOT}/${entry}.wesl is missing`);
    }
    const out = [];
    for (const [entry, spec] of Object.entries(manifest)) {
        for (const enabled of conditionSubsets(spec.conditions)) {
            const code = await linkShader(entry, enabled, { sources, manifest });
            out.push({ file: linkedFileName(entry, enabled), entry, enabled, code });
        }
    }

    const used = new Set(Object.values(sources).flatMap((s) => [...attributeNames(s)]));
    const emitted = new Set(out.flatMap(({ code }) => [...attributeNames(code)]));
    const dropped = [...used].filter((a) => !emitted.has(a));
    if (dropped.length) {
        throw new Error(`gen-shaders: the linker dropped attribute(s) ${dropped.map((a) => `@${a}`).join(', ')} — `
            + 'use the WGSL spec spelling (wesl only emits attributes it knows)');
    }
    return out;
}

/**
 * Bring public/shaders in line with the sources: write changed files and remove
 * orphans, or with `check` only report them. Returns the stale paths.
 * @param {{ check?: boolean, root?: string }} [options]
 */
export async function syncLinkedShaders({ check = false, root = repoRoot } = {}) {
    const files = await linkAll(root);
    const dir = join(root, LINKED_DIR);
    const expected = new Set(files.map((f) => f.file));
    /** @type {string[]} */
    const stale = [];
    for (const { file, code } of files) {
        const path = join(dir, file);
        const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (current === code) continue;
        stale.push(file);
        if (!check) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(path, code);
        }
    }
    const orphans = existsSync(dir) ? walk(dir).filter((f) => f.endsWith('.wgsl') && !expected.has(f)) : [];
    for (const file of orphans) {
        stale.push(`${file} (not produced by any entry)`);
        if (!check) rmSync(join(dir, file));
    }
    return { files: files.length, stale };
}

async function main() {
    const check = process.argv.includes('--check');
    const { files, stale } = await syncLinkedShaders({ check });
    const rel = relative(repoRoot, join(repoRoot, LINKED_DIR));
    if (check) {
        if (stale.length) {
            console.error(`[gen:shaders] ${rel} is stale — run \`npm run gen:shaders\`:\n  ${stale.join('\n  ')}`);
            process.exit(1);
        }
        console.log(`[gen:shaders] ${files} linked shaders in ${rel} are current`);
        return;
    }
    console.log(`[gen:shaders] linked ${files} shaders into ${rel} (${stale.length} changed)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
