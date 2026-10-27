/**
 * `scripts/sw-manifest.mjs` is plain ESM (`allowJs: false`); `swManifest.test.ts`
 * imports it to check the service worker's precache list against the shipped files.
 */
declare module '*/scripts/sw-manifest.mjs' {
    export const STATIC_PRECACHE_URLS: string[];
    export const GENERATED_PRECACHE_URLS: string[];
    export function listShaderUrls(root: string): string[];
    export function buildPrecacheUrls(root: string): string[];
    export function swCacheId(root: string, buildVersion?: string): string;
    export function stampServiceWorker(
        source: string,
        stamp: { cacheId: string; shaderUrls: string[] },
    ): string;
}
