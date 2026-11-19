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

/**
 * Modules on the frame clock that measure **real** time on purpose. Every
 * other module that imports `xr/frameClock` takes time from `frameNow()` (or
 * its frame callback's time), so a virtual frame step (#374) moves it too.
 */
const REAL_TIME_READERS: Record<string, string> = {
  'services/capture/canvasRecorder.ts': 'the real-time recorder: a clip lasts what the wall clock says',
  'services/capture/virtualFrameStepper.ts': 'waits for inputs on the real clock; only steps move app time',
  'renderer/frameSource/mapsCanvasSource.ts': 'a readback’s age is wall time (Maps renders on its own clock)',
  'app/LiveConditionsDriver.tsx': 'the Open-Meteo fetch throttle (Date.now) is wall time',
};

describe('frame loops go through xr/frameClock', () => {
  const files = walk(SRC).filter((f) => !f.startsWith(XR_DIR + path.sep));

  it.each(['requestAnimationFrame', 'cancelAnimationFrame'])('never references %s outside xr/', (name) => {
    const offenders = files.filter((f) => new RegExp(`\\b${name}\\b`).test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('modules on the frame clock read app time from it (#374), not performance.now / Date.now', () => {
    const offenders = files
      .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), code: stripComments(fs.readFileSync(f, 'utf8')) }))
      .filter(({ code }) => /from '(?:\.\.\/)+xr\/frameClock'/.test(code))
      .filter(({ code }) => /\b(?:performance|Date)\.now\(/.test(code))
      .map(({ rel }) => rel)
      .filter((rel) => !(rel in REAL_TIME_READERS));
    expect(offenders).toEqual([]);
  });

  it('every real-time exception still imports the clock (a stale entry hides nothing)', () => {
    for (const rel of Object.keys(REAL_TIME_READERS)) {
      const code = stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));
      expect(code, rel).toMatch(/from '(?:\.\.\/)+xr\/frameClock'/);
      expect(code, rel).toMatch(/\b(?:performance|Date)\.now\(/);
    }
  });
});
