/**
 * Every shader module and pipeline goes through `gpuPipelineFactory.ts`.
 *
 * A direct `device.createRenderPipeline()` cannot fail loudly — it returns an
 * invalid pipeline that poisons the frame's command buffer — and an unlabeled
 * object is anonymous in every validation message, about:gpu and RenderDoc.
 * The factory's descriptor types *require* a `label`, so routing every call
 * through it is what makes "labeled" and "validation-checked" hold.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..');
const FACTORY = 'src/renderer/gpuPipelineFactory.ts';

function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') sources(full, out);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const DIRECT_CREATE = /\.(createShaderModule|createRenderPipeline|createComputePipeline)(Async)?\s*\(/g;

describe('GPU object creation', () => {
    const files = sources(join(ROOT, 'src'));

    it('goes through gpuPipelineFactory — no direct module/pipeline creation in app code', () => {
        const offenders: string[] = [];
        for (const file of files) {
            const rel = relative(ROOT, file);
            if (rel === FACTORY) continue;
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(DIRECT_CREATE)) {
                const line = text.slice(0, match.index).split('\n').length;
                offenders.push(`${rel}:${line} ${match[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('labels every checked module and pipeline (the descriptor types require it)', () => {
        const unlabeled: string[] = [];
        const call = /create(ShaderModule|RenderPipeline|ComputePipeline)Checked\(\s*[\w.]+,\s*\{/g;
        for (const file of files) {
            const rel = relative(ROOT, file);
            if (rel === FACTORY) continue;
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(call)) {
                // The descriptor literal's first lines must name it.
                const head = text.slice(match.index! + match[0].length, match.index! + match[0].length + 120);
                if (!/^\s*label:/.test(head)) {
                    unlabeled.push(`${rel}:${text.slice(0, match.index).split('\n').length}`);
                }
            }
        }
        expect(unlabeled).toEqual([]);
    });
});
