/**
 * Which commit is running. The same object `vite build` writes to `build/build-info.json`
 * (scripts/build-info.mjs → vite.config.ts), inlined as `VITE_PUBLIC_BUILD_INFO`, and published
 * as `window.__SV__.build` — so "what is live?" is answerable from the console and from a URL.
 *
 * Public by construction: a commit, a version, a timestamp and a branch name. No env values.
 */

export interface BuildInfo {
  /** Full 40-hex commit the bundle was built from; `unknown` when the build had no git checkout. */
  readonly sha: string;
  readonly shortSha: string;
  /** package.json `version` — SemVer, release candidates carry `-rc.N`. */
  readonly version: string;
  /** ISO-8601 UTC build time. */
  readonly builtAt: string;
  /** True when tracked files differed from `sha` at build time. */
  readonly dirty: boolean;
  readonly ref: string | null;
}

const UNKNOWN: BuildInfo = Object.freeze({ sha: 'unknown', shortSha: 'unknown', version: '0.0.0', builtAt: '', dirty: false, ref: null });

/** Parse the inlined JSON; anything malformed degrades to the `unknown` build instead of throwing at boot. */
export function parseBuildInfo(raw: string | undefined): BuildInfo {
  if (!raw) return UNKNOWN;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return UNKNOWN;
    const o = value as Record<string, unknown>;
    if (typeof o.sha !== 'string' || typeof o.version !== 'string') return UNKNOWN;
    return Object.freeze({
      sha: o.sha,
      shortSha: typeof o.shortSha === 'string' ? o.shortSha : o.sha.slice(0, 7),
      version: o.version,
      builtAt: typeof o.builtAt === 'string' ? o.builtAt : '',
      dirty: o.dirty === true,
      ref: typeof o.ref === 'string' ? o.ref : null,
    });
  } catch {
    return UNKNOWN;
  }
}

export const BUILD_INFO: BuildInfo = parseBuildInfo(import.meta.env.VITE_PUBLIC_BUILD_INFO);
