/**
 * onnxruntime-web and the depth model never enter the bundle (#320) — the
 * source-side half of the guard; `scripts/check-bundle-budget.sh` checks the
 * built output. Same shape as `cesiumMainBundleGuard.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEPTH_RUNTIME_URL } from './depthModel';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sources(full, out);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe('scene depth stays out of the bundle', () => {
    it('onnxruntime-web is not a dependency', () => {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
            expect(Object.keys(pkg[field] ?? {}).filter((d) => d.startsWith('onnxruntime'))).toEqual([]);
        }
    });

    it('no source imports the runtime or a model by specifier', () => {
        const offenders = sources(join(root, 'src')).filter((file) =>
            /from\s+['"]onnxruntime|import\(\s*['"]onnxruntime|\.onnx['"]/.test(readFileSync(file, 'utf8')));
        expect(offenders.map((f) => relative(root, f))).toEqual([]);
    });

    it('the runtime is one pinned CDN URL, imported only inside the Worker', () => {
        expect(DEPTH_RUNTIME_URL).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\d+\.\d+\.\d+\/dist\/ort\.webgpu\.min\.mjs$/);
        const worker = readFileSync(join(here, 'depthWorker.ts'), 'utf8');
        expect(worker).toMatch(/await import\(\/\* @vite-ignore \*\/ request\.runtimeUrl\)/);
        const dynamicImports = sources(join(root, 'src'))
            .filter((file) => /import\(\s*\/\*\s*@vite-ignore/.test(readFileSync(file, 'utf8')))
            .map((f) => relative(root, f));
        expect(dynamicImports).toEqual(['src/renderer/depth/depthWorker.ts']);
    });

    it('the Worker is reached only as a Worker URL, never as a module import', () => {
        const importers = sources(join(root, 'src'))
            .filter((file) => /from\s+['"][./]*depthWorker['"]|import\(['"][./]*depthWorker/.test(readFileSync(file, 'utf8')))
            .map((f) => relative(root, f));
        expect(importers).toEqual([]);
        expect(readFileSync(join(here, 'DepthEstimator.ts'), 'utf8'))
            .toContain("new Worker(new URL('./depthWorker.ts', import.meta.url)");
    });
});
