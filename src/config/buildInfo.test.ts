import { describe, expect, it } from 'vitest';
import { BUILD_INFO, parseBuildInfo } from './buildInfo';

const SHA = 'a'.repeat(40);

describe('parseBuildInfo', () => {
  it('reads the JSON vite.config.ts inlines', () => {
    const info = parseBuildInfo(JSON.stringify({ sha: SHA, shortSha: 'aaaaaaa', version: '1.0.0-rc.0', builtAt: '2026-11-26T10:00:00.000Z', dirty: true, ref: 'main' }));
    expect(info).toEqual({ sha: SHA, shortSha: 'aaaaaaa', version: '1.0.0-rc.0', builtAt: '2026-11-26T10:00:00.000Z', dirty: true, ref: 'main' });
    expect(Object.isFrozen(info)).toBe(true);
  });

  it.each([undefined, '', 'not json', 'null', '"text"', '{"sha":1}', '{"sha":"x"}'])('degrades to the unknown build for %j, never throwing at boot', (raw) => {
    expect(parseBuildInfo(raw)).toMatchObject({ sha: 'unknown', version: '0.0.0', dirty: false, ref: null });
  });

  it('derives a short sha and tolerates missing optional fields', () => {
    expect(parseBuildInfo(JSON.stringify({ sha: SHA, version: '1.0.0' }))).toMatchObject({ shortSha: 'aaaaaaa', builtAt: '', dirty: false, ref: null });
  });
});

describe('BUILD_INFO', () => {
  it('is the commit this test run is on, with the package version', () => {
    expect(BUILD_INFO.sha).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
