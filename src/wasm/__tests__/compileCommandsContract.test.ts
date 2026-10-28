import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

/** Every translation unit in cpp/src, as the filenames the lists below spell. */
const TRANSLATION_UNITS = readdirSync(join(ROOT, 'cpp', 'src'))
    .filter((f) => f.endsWith('.cpp'))
    .sort();

/** Basenames of the `.cpp` paths a build/lint list mentions, deduped and sorted. */
function listedSources(text: string): string[] {
    return Array.from(
        new Set(Array.from(text.matchAll(/([A-Za-z0-9_]+\.cpp)/g), (m) => m[1]!)),
    ).sort();
}

describe('C++ compile_commands contract', () => {
    const cmake = read('cpp', 'CMakeLists.txt');

    it('does not symlink compile_commands.json to whichever tree last built', () => {
        expect(cmake).not.toMatch(/create_symlink/);
    });

    it('only copies compile_commands.json from the non-sanitizer build-host tree', () => {
        expect(cmake).toMatch(/NOT STREETVIEW_SANITIZERS/);
        expect(cmake).toMatch(/build-host/);
        expect(cmake).toMatch(/copy_if_different/);
        expect(cmake).toMatch(/compile_commands\.json/);
    });

    it('has more than one translation unit (the numeric layer is split by domain)', () => {
        expect(TRANSLATION_UNITS).toContain('noise_module.cpp');
        expect(TRANSLATION_UNITS).toContain('geodesy_module.cpp');
        expect(TRANSLATION_UNITS).toContain('audio_module.cpp');
        expect(TRANSLATION_UNITS).toContain('luma_module.cpp');
        expect(TRANSLATION_UNITS).toContain('cabin_dsp_module.cpp');
        expect(TRANSLATION_UNITS).toContain('depth_module.cpp');
        expect(TRANSLATION_UNITS).toContain('runtime.cpp');
    });

    it('lists every translation unit once, for the host and both main Emscripten targets', () => {
        const sources = cmake.match(/set\(STREETVIEW_SOURCES([\s\S]*?)\)/);
        expect(sources).not.toBeNull();
        expect(listedSources(sources![1]!)).toEqual(TRANSLATION_UNITS);
        // runtime.cpp (sv_malloc/sv_free/stack bounds) has no header twin to include it.
        expect(listedSources(sources![1]!)).toContain('runtime.cpp');
        // Same sources, same flags but -msimd128: never a second source list.
        expect(cmake).toMatch(/add_library\(streetview_cpu STATIC \$\{STREETVIEW_SOURCES\}\)/);
        expect(cmake).toMatch(/add_library\(streetview_cpu_simd STATIC \$\{STREETVIEW_SOURCES\}\)/);
        expect(cmake).toMatch(/add_executable\(streetview-wasm \$\{STREETVIEW_SOURCES\}\)/);
        expect(cmake).toMatch(/add_executable\(streetview-wasm-simd \$\{STREETVIEW_SOURCES\}\)/);
    });

    it('builds the worklet binary from the cabin engine and the runtime only', () => {
        const dsp = cmake.match(/set\(STREETVIEW_DSP_SOURCES([\s\S]*?)\)/);
        expect(dsp).not.toBeNull();
        expect(listedSources(dsp![1]!)).toEqual(['cabin_dsp_module.cpp', 'runtime.cpp']);
        expect(cmake).toMatch(/add_executable\(streetview-dsp-simd \$\{STREETVIEW_DSP_SOURCES\}\)/);
    });

    it('lints every translation unit in scripts/lint-cpp.sh', () => {
        const sources = read('scripts', 'lint-cpp.sh').match(/SOURCES=\(([\s\S]*?)\)/);
        expect(sources).not.toBeNull();
        expect(listedSources(sources![1]!)).toEqual(TRANSLATION_UNITS);
    });

    it('hashes every public and internal header into the wasm staleness check', () => {
        const hashed = read('scripts', 'wasm-source-hash.mjs');
        for (const header of readdirSync(join(ROOT, 'cpp', 'include', 'streetview')).filter((f) => f.endsWith('.h'))) {
            expect(hashed).toContain(`cpp/include/streetview/${header}`);
        }
    });

    it('hashes every translation unit into the wasm staleness check', () => {
        const files = read('scripts', 'wasm-source-hash.mjs').match(
            /WASM_SOURCE_FILES = \[([\s\S]*?)\]/,
        );
        expect(files).not.toBeNull();
        expect(listedSources(files![1]!)).toEqual(TRANSLATION_UNITS);
    });
});
