/**
 * Every app frame loop schedules through `xr/frameClock.ts`: a headset can
 * stop the window's rAF while immersive, and an XR sub-image is only valid
 * inside the session callback (CLAUDE.md "Split frame / WebXR"). Same shape
 * as the `location.search` scan in `config/flags.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const XR_DIR = path.join(SRC, 'xr');

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

describe('frame loops go through xr/frameClock', () => {
  const files = walk(SRC).filter((f) => !f.startsWith(XR_DIR + path.sep));

  it.each(['requestAnimationFrame', 'cancelAnimationFrame'])('never references %s outside xr/', (name) => {
    const offenders = files.filter((f) => new RegExp(`\\b${name}\\b`).test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
