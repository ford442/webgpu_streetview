import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Isolation guard for the compact HUD: the 3D instrument cluster
 * (`src/car/interior/CarInteriorGauges.ts`) is the analog speedo/tacho SSOT.
 * `src/car/` must not reintroduce a floating DOM SVG dial (CircularGauge /
 * SpeedGauge / RpmGauge / GaugeDashboard) that fights it — only the compact
 * TelemetryChip + GearIndicator are allowed in production files.
 */
describe('car HUD analog-gauge isolation', () => {
  const FORBIDDEN = ['CircularGauge', 'SpeedGauge', 'RpmGauge', 'GaugeDashboard'];

  it('does not import or reference analog SVG dials under src/car/ production files', () => {
    const carDir = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          const contents = fs.readFileSync(full, 'utf8');
          for (const symbol of FORBIDDEN) {
            if (new RegExp(`\\b${symbol}\\b`).test(contents)) {
              offenders.push(`${path.relative(carDir, full)} references ${symbol}`);
            }
          }
        }
      }
    };
    walk(carDir);

    expect(offenders).toEqual([]);
  });
});
