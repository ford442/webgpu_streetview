/**
 * `scripts/validate-shaders.mjs` and `scripts/gen-shaders.mjs` are plain ESM
 * (`allowJs: false`); `src/renderer/linkedShaders.test.ts` imports them to check
 * that public/shaders is the current link of src/shaders and that every linked
 * variant is naga-valid. Declare just those exports.
 */
declare module '*/scripts/validate-shaders.mjs' {
    /** Linked files naga cannot validate (file → reason); each still compiles on Tint. */
    export const NAGA_KNOWN_GAPS: Record<string, string>;
    export function linkedShaderFiles(root?: string): string[];
}

declare module '*/scripts/gen-shaders.mjs' {
    export const WESL_ROOT: string;
    export const SHADER_MANIFEST: string;
    export const LINKED_DIR: string;
    export function readWeslSources(root?: string): Record<string, string>;
    export function conditionSubsets(conditions?: string[]): string[][];
    export function linkedFileName(entry: string, enabled?: string[]): string;
    export function linkShader(entry: string, enabled?: string[]): Promise<string>;
    export function linkAll(root?: string): Promise<Array<{ file: string; entry: string; enabled: string[]; code: string }>>;
    export function syncLinkedShaders(options?: { check?: boolean; root?: string }): Promise<{ files: number; stale: string[] }>;
}
