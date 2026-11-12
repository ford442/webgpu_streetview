/**
 * #367: `runtime/contexts.ts` is the one reader of the machine's display and
 * power answers, and `audio/audioRuntime.ts` the one creator of an
 * AudioContext. Same shape as `xr/frameClock.scan.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = walk(SRC);
const offenders = (pattern: RegExp, allowed: string[]): string[] =>
  files
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) => !allowed.includes(rel))
    .filter((rel) => pattern.test(stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'))));

describe('runtime contexts own the machine probes', () => {
  it('only runtime/contexts.ts queries the display for HDR / P3', () => {
    // A media-query string literal: `'(dynamic-range: …'` / `"(color-gamut: …"`.
    expect(offenders(/['"]\(\s*(?:dynamic-range|color-gamut)\s*:/, ['runtime/contexts.ts'])).toEqual([]);
  });

  it('only runtime/contexts.ts reads the Battery API', () => {
    expect(offenders(/\bgetBattery\b/, ['runtime/contexts.ts'])).toEqual([]);
  });

  it('only audio/audioRuntime.ts creates an AudioContext', () => {
    expect(offenders(/\bcreateBrowserAudioContext\s*\(/, ['audio/audioRuntime.ts', 'audio/createAudioContext.ts'])).toEqual([]);
    expect(offenders(/\bnew\s+(?:window\.)?(?:webkit)?AudioContext\b/, [])).toEqual([]);
  });
});
