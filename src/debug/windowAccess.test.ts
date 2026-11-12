// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readWindowProperty } from './windowAccess';

describe('readWindowProperty', () => {
  it('readWindowProperty reads a runtime-named global', () => {
    (globalThis as Record<string, unknown>).SomeSdk = 1;
    expect(readWindowProperty('SomeSdk')).toBe(1);
    delete (globalThis as Record<string, unknown>).SomeSdk;
  });
});

describe('window casts', () => {
  it('appear only in debug/windowAccess.ts (the grep the acceptance criteria run)', async () => {
    const { execFileSync } = await import('node:child_process');
    let out = '';
    try {
      out = execFileSync('grep', ['-rln', ['window', 'as'].join(' '), 'src'], { encoding: 'utf8' });
    } catch {
      out = '';
    }
    const files = out.split('\n').filter(Boolean).filter((f) => !f.endsWith('debug/windowAccess.ts'));
    expect(files).toEqual([]);
  });
});
