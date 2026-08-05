import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Static arity guard for the weather WGSL.
 *
 * `weather-post-compute.wgsl` shipped for some time with
 * `applyVolumetricLightShafts(col, uv, intensity, t)` in main() against a
 * 3-parameter definition. WGSL is only compiled when a GPU device exists, so
 * nothing in CI (or in any GPU-less environment) noticed that the entire
 * compute module failed to build and `?weather=compute` silently did nothing.
 *
 * This walks every locally-defined function call in both shaders and checks the
 * argument count against the declaration — the cheap half of what a real WGSL
 * compiler would tell us, minus the GPU.
 */

function readShader(name: string): string {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shaders', name), 'utf8');
}

/** Strip line comments so commented-out code can't produce phantom calls. */
function stripComments(source: string): string {
    return source.replace(/\/\/.*$/gm, '');
}

/** Map of locally-declared function name → declared parameter count. */
function declaredFunctions(source: string): Map<string, number> {
    const declarations = new Map<string, number>();
    const re = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        const params = match[2]!.trim();
        declarations.set(match[1]!, params === '' ? 0 : params.split(',').length);
    }
    return declarations;
}

/** Argument count of the call starting at `openParen`, respecting nesting. */
function countArguments(source: string, openParen: number): number | null {
    let depth = 0;
    let args = 0;
    let sawContent = false;
    for (let i = openParen; i < source.length; i += 1) {
        const ch = source[i]!;
        if (ch === '(' || ch === '[' || ch === '<') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '>') {
            depth -= 1;
            if (depth === 0) return sawContent ? args + 1 : 0;
        } else if (ch === ',' && depth === 1) args += 1;
        else if (!/\s/.test(ch) && depth >= 1) sawContent = true;
    }
    return null;
}

interface ArityMismatch {
    fn: string;
    declared: number;
    called: number;
}

function findArityMismatches(rawSource: string): ArityMismatch[] {
    const source = stripComments(rawSource);
    const declarations = declaredFunctions(source);
    const mismatches: ArityMismatch[] = [];

    for (const [name, declared] of declarations) {
        // Match calls but not the declaration itself (`fn name(`).
        const re = new RegExp(`(^|[^A-Za-z0-9_])${name}\\s*\\(`, 'g');
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
            const before = source.slice(Math.max(0, match.index - 4), match.index + match[1]!.length);
            if (/\bfn\s*$/.test(before)) continue;

            const openParen = source.indexOf('(', match.index + match[0]!.length - 1);
            const called = countArguments(source, openParen);
            if (called !== null && called !== declared) {
                mismatches.push({ fn: name, declared, called });
            }
        }
    }
    return mismatches;
}

describe('weather WGSL call arity', () => {
    it.each(['weather-post.wgsl', 'weather-post-compute.wgsl'])(
        '%s calls every locally-defined function with its declared argument count',
        (shader) => {
            expect(findArityMismatches(readShader(shader))).toEqual([]);
        }
    );

    it('detects a mismatched call (guard is actually working)', () => {
        const broken = `
            fn helper(a: f32, b: f32) -> f32 { return a + b; }
            fn main() -> f32 { return helper(1.0, 2.0, 3.0); }
        `;
        expect(findArityMismatches(broken)).toEqual([
            { fn: 'helper', declared: 2, called: 3 },
        ]);
    });

    it('accepts nested calls and zero-argument functions', () => {
        const fine = `
            fn zero() -> f32 { return 1.0; }
            fn add(a: f32, b: f32) -> f32 { return a + b; }
            fn main() -> f32 { return add(add(zero(), 2.0), zero()); }
        `;
        expect(findArityMismatches(fine)).toEqual([]);
    });
});
