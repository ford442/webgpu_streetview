/**
 * The WESL shader tree (`src/shaders/**\/*.wesl`) and what it links to
 * (`public/shaders/*.wgsl`, `scripts/gen-shaders.mjs`). This replaces the old
 * byte-identical parity tests: a helper now has one source, so the questions are
 * whether anything was copied anyway, whether the linked files are the current
 * link of that source, whether every variant the runtime can ask for is valid
 * WGSL, and whether each variant differs from the default only where its
 * condition says it may.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkAll, syncLinkedShaders } from '../../scripts/gen-shaders.mjs';
import { linkedShaderFiles, NAGA_KNOWN_GAPS } from '../../scripts/validate-shaders.mjs';
import { allWeslSources, fnSource, LINKED_DIR, readLinked, squash } from '../shaders/__tests__/shaderSources';
import { EXTENDED_TONEMAP_HEADROOM } from './shaderFeatureVariants';

const REPO = join(__dirname, '..', '..');
const nagaAvailable = spawnSync('naga', ['--version'], { encoding: 'utf8' }).status === 0;

/** Non-entry functions declared in a WESL source (an `@if` / `@else` pair is one definition). */
function helperNames(source: string): Set<string> {
    const names = new Set<string>();
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/((?:@[\w]+(?:\([^)]*\))?\s*)*)\bfn\s+(\w+)\s*\(/g)) {
        if (/@(vertex|fragment|compute)\b/.test(m[1] ?? '')) continue;
        names.add(m[2]!);
    }
    return names;
}

/** A linked shader minus one function's definition, normalised. */
function without(code: string, ...fns: string[]): string {
    let out = code;
    for (const fn of fns) out = out.replace(fnSource(out, fn), '');
    return squash(out.replace(/^\/\/ GENERATED.*$/gm, ''));
}

describe('WESL sources: every helper is written once', () => {
    it('no helper function is defined in more than one shader source file', () => {
        const where = new Map<string, string[]>();
        for (const [path, source] of allWeslSources()) {
            for (const name of helperNames(source)) where.set(name, [...(where.get(name) ?? []), path]);
        }
        const copies = [...where].filter(([, paths]) => paths.length > 1).map(([name, paths]) => `${name}: ${paths.join(', ')}`);
        expect(copies).toEqual([]);
        // The shared blocks are declared once too.
        for (const struct of ['SceneDepthParams', 'SceneSemanticParams', 'WeatherParams']) {
            const decls = [...allWeslSources()].filter(([, s]) => new RegExp(`\\bstruct ${struct}\\b`).test(s));
            expect(decls.map(([p]) => p), struct).toHaveLength(1);
        }
    });

    it('no app module imports the linker (it runs at build time only)', () => {
        const hits = spawnSync('git', ['grep', '-l', "from 'wesl", '--', 'src', ':!src/**/*.test.ts'], { cwd: REPO, encoding: 'utf8' });
        expect(hits.stdout.trim()).toBe('');
    });
});

describe('public/shaders is the current link of src/shaders', () => {
    it('every linked file matches a fresh link and none is orphaned (`npm run gen:shaders`)', async () => {
        const { stale } = await syncLinkedShaders({ check: true });
        expect(stale).toEqual([]);
    }, 30_000);

    it('ships one file per entry and condition subset, and nothing else', async () => {
        const linked = await linkAll();
        expect(linkedShaderFiles()).toEqual(linked.map((l) => l.file).sort());
    }, 30_000);
});

describe.skipIf(!nagaAvailable)('every linked variant is valid WGSL (naga)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linked-wgsl-'));
    it.each(linkedShaderFiles().filter((f) => !(f in NAGA_KNOWN_GAPS)))('%s', (file) => {
        // naga validates subgroup operations without the directive it does not take.
        const code = readFileSync(join(LINKED_DIR, file), 'utf8').replace(/^enable subgroups;$/m, '');
        const path = join(dir, file);
        writeFileSync(path, code);
        const result = spawnSync('naga', [path], { encoding: 'utf8' });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    });
});

describe('each variant differs from the default only where its condition says', () => {
    it('hdr_grade swaps the ACES body for the output-referred one at EXTENDED_TONEMAP_HEADROOM, nothing else', () => {
        for (const entry of ['weather-post', 'weather-post-compute']) {
            const sdr = readLinked(`${entry}.wgsl`);
            const hdr = readLinked(`${entry}.hdr_grade.wgsl`);
            expect(without(hdr, 'aces_tonemap'), entry).toBe(without(sdr, 'aces_tonemap'));
            expect(squash(fnSource(sdr, 'aces_tonemap'))).toContain(
                'return clamp((color*(a*color+b))/(color*(c*color+d)+e),vec3<f32>(0.0),vec3<f32>(1.0));',
            );
            const ext = squash(fnSource(hdr, 'aces_tonemap'));
            expect(ext).toContain(`let headroom=${EXTENDED_TONEMAP_HEADROOM.toFixed(1)};`);
            expect(ext).toContain('let x=color/headroom;');
            expect(ext).toContain('return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3<f32>(0.0),vec3<f32>(1.0))*headroom;');
        }
    });

    it('dual_source only adds the directive and an fs_main that also writes precip to @blend_src(1)', () => {
        for (const hdr of ['', '.hdr_grade']) {
            const scalar = readLinked(`weather-post${hdr}.wgsl`);
            const dual = readLinked(`weather-post.dual_source${hdr}.wgsl`);
            expect(scalar).not.toContain('enable dual_source_blending;');
            expect(dual).toMatch(/^enable dual_source_blending;$/m);
            expect(dual).toMatch(/@location\(0\) @blend_src\(0\) color: vec4<f32>/);
            expect(dual).toMatch(/@location\(0\) @blend_src\(1\) precip: vec4<f32>/);
            expect(squash(fnSource(dual, 'fs_main'))).toContain('return DualFragOut(s.color,vec4<f32>(s.precip,0.0));');
            expect(squash(fnSource(scalar, 'fs_main'))).toContain('return shadeWeather(fragCoord).color;');
            const rest = (code: string) => without(code, 'fs_main')
                .replace('enable dual_source_blending;', '')
                .replace(/struct DualFragOut\{[^}]*\}/, '');
            expect(rest(dual)).toBe(rest(scalar));
        }
    });

    it('subgroups (gpu-chores histogram) enables the extension and coalesces the atomics; the default stays scalar', () => {
        const scalar = readLinked('gpu-chores-hist.wgsl');
        const sub = readLinked('gpu-chores-hist.subgroups.wgsl');
        expect(scalar).not.toContain('enable subgroups');
        expect(scalar).not.toContain('subgroupShuffle');
        expect(sub).toMatch(/^enable subgroups;$/m);
        expect(sub).toContain('subgroupShuffle(bin, i)');
        expect(without(sub, 'luma_histogram_bt709').replace('enable subgroups;', ''))
            .toBe(without(scalar, 'luma_histogram_bt709'));
    });
});
