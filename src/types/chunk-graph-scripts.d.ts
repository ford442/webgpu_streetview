/**
 * `scripts/check-chunk-graph.mjs` is plain ESM (`allowJs: false`); `src/config/chunkContracts.test.ts`
 * imports its checker to prove an `onnxruntime-web` / `cesium` module in the main chunk fails.
 */
declare module '*/scripts/check-chunk-graph.mjs' {
    export function checkChunkGraph(
        graph: {
            chunks: Record<string, { name: string; isEntry: boolean; modules: string[] }>;
            modules: Record<string, string[]>;
        },
        contracts: {
            main?: { forbidden?: string[] };
            chunks?: Array<{ name: string; entry: string; forbidden?: string[] }>;
            singletons?: Array<{ module: string }>;
        },
    ): string[];
}
