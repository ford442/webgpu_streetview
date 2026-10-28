/**
 * `scripts/gen-wasm-abi.mjs` and `scripts/check-wasm-abi.mjs` are plain ESM
 * (`allowJs: false`); `wasmAbiLock.test.ts` imports them to check the
 * generated table and the committed binaries against cpp/include/streetview/abi.h.
 */
declare module '*/scripts/gen-wasm-abi.mjs' {
    export interface AbiExport {
        name: string;
        symbol: string;
        decl: string;
        params: { type: string; name: string; wasm: string }[];
        result: string | null;
        unit: string;
        binaries: ('main' | 'dsp')[];
    }
    export const ABI_HEADER: string;
    export const ABI_GENERATED: string;
    export function parseAbiHeader(root?: string): AbiExport[];
    export function generateAbiModule(root?: string): string;
}

declare module '*/scripts/check-wasm-abi.mjs' {
    import type { AbiExport } from '*/scripts/gen-wasm-abi.mjs';
    export const RUNTIME_EXTRAS: Set<string>;
    export const DSP_MAX_BYTES: number;
    export function checkWasmBinary(bytes: Uint8Array, kind: 'main' | 'dsp', abi: AbiExport[]): string[];
}

declare module '*/scripts/wasm-source-hash.mjs' {
    export const WASM_SOURCE_FILES: string[];
    export function wasmSourceHash(repoRoot: string): string;
}
