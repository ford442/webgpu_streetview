/**
 * `scripts/validate-shaders.mjs` is plain ESM (`allowJs: false`), but it holds
 * the WGSL bodies the naga variant check substitutes, and
 * `src/renderer/shaderFeatureVariants.test.ts` imports them to prove they have
 * not drifted from the runtime assembler. Declare just those exports.
 */
declare module '*/scripts/validate-shaders.mjs' {
    export const SDR_ACES_TONEMAP_BODY: string;
    export const EXTENDED_ACES_TONEMAP_BODY: string;
}
