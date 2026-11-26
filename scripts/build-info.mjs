/**
 * Which commit is this build? One resolver for every consumer, so the file, the bundle and the
 * runtime global can never disagree:
 *
 * - vite.config.ts   → `build/build-info.json` and `import.meta.env.VITE_PUBLIC_BUILD_INFO`
 *                      (read at run time as `window.__SV__.build`, src/config/buildInfo.ts)
 * - verify-build.sh  → scripts/check-build-info.mjs compares the file with the checkout and the bundle
 * - verify-live.mjs  → compares the DEPLOYED file with the commit that was meant to ship
 *
 * Nothing here reads a secret: the commit, the package version, the clock and a branch name.
 *
 * Overrides, for builds with no `.git` (a container build context, a source tarball):
 *   SV_BUILD_SHA   the full 40-hex commit
 *   SV_BUILD_REF   the branch or tag name (optional)
 *   SOURCE_DATE_EPOCH   the build time in seconds (the reproducible-builds convention)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} BuildInfo
 * @property {string} sha       full 40-hex commit the bundle was built from (`unknown` only when neither git nor SV_BUILD_SHA is available)
 * @property {string} shortSha  first 7 characters of `sha`
 * @property {string} version   package.json `version` (SemVer; release candidates carry `-rc.N`)
 * @property {string} builtAt   ISO-8601 UTC build time
 * @property {boolean} dirty    tracked files differed from the commit when the build ran — such a build is not reproducible from `sha`
 * @property {string | null} ref  branch or tag, when known
 */

const FULL_SHA = /^[0-9a-f]{40}$/;

/** @param {string} cwd @param {string[]} args @returns {string | null} */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {{ root: string, env?: NodeJS.ProcessEnv, now?: Date }} options
 * @returns {BuildInfo}
 */
export function resolveBuildInfo({ root, env = process.env, now = new Date() }) {
  const override = (env.SV_BUILD_SHA ?? '').trim().toLowerCase();
  const fromGit = git(root, ['rev-parse', 'HEAD']);
  const sha = FULL_SHA.test(override) ? override : fromGit && FULL_SHA.test(fromGit) ? fromGit : 'unknown';

  // Only tracked files count: ignored artifacts (build/, .env.local, fetched models) are not "the source".
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']);
  const dirty = FULL_SHA.test(override) ? false : status !== null && status !== '';

  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const ref = (env.SV_BUILD_REF ?? '').trim() || (branch && branch !== 'HEAD' ? branch : null) || (env.GITHUB_REF_NAME ?? '').trim() || null;

  const epoch = Number(env.SOURCE_DATE_EPOCH);
  const builtAt = (Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : now).toISOString();

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return { sha, shortSha: sha === 'unknown' ? sha : sha.slice(0, 7), version: String(pkg.version), builtAt, dirty, ref };
}
