/**
 * Test helpers for the WESL shader tree. Tests read helpers where they are
 * defined — once, in `src/shaders/**\/*.wesl` — and whole-shader properties
 * (bindings, which helpers an entry links, call order) from the linked WGSL in
 * `public/shaders`, which is exactly what the device compiles
 * (`scripts/gen-shaders.mjs`; `npm run gen:shaders` keeps it current).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..', '..', '..');
const WESL_DIR = join(REPO, 'src', 'shaders');
export const LINKED_DIR = join(REPO, 'public', 'shaders');

/** A WESL source by its path under src/shaders, e.g. `weather/semantic.wesl`. */
export function readWesl(path: string): string {
    return readFileSync(join(WESL_DIR, path), 'utf8');
}

/** A linked shader as the renderer fetches it, e.g. `weather-post.hdr_grade.wgsl`. */
export function readLinked(file: string): string {
    return readFileSync(join(LINKED_DIR, file), 'utf8');
}

/** Every `.wesl` under src/shaders: path (relative, `/`-separated) → source. */
export function allWeslSources(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.wesl')) out.set(relative(WESL_DIR, full).split('\\').join('/'), readFileSync(full, 'utf8'));
        }
    };
    walk(WESL_DIR);
    return out;
}

/** `fn name(...) { ... }`, brace-matched, from its first definition in `source`. */
export function fnSource(source: string, name: string): string {
    const start = source.search(new RegExp(`\\bfn ${name}\\(`));
    if (start < 0) throw new Error(`fn ${name} not found`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`fn ${name} unterminated`);
}

/** WGSL with comments and whitespace removed, so a check survives the linker's formatting. */
export function squash(code: string): string {
    return code
        .replace(/\/\/.*$/gm, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}();,+\-*/=<>:[\]])\s*/g, '$1')
        .trim();
}
