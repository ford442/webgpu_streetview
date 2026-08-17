import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CESIUM_SDK_BUILD_URL } from '../useGlobeMode';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function countCesium(source: string): number {
  return (source.match(/Cesium/g) ?? []).length;
}

describe('globe SDK tokens on the main-chunk path', () => {
  it('keeps a single PascalCase Cesium token in the CDN build URL', () => {
    expect(CESIUM_SDK_BUILD_URL).toContain('/Build/Cesium');
    expect(countCesium(CESIUM_SDK_BUILD_URL)).toBe(1);
  });

  it('does not mention Cesium in ConnectedChrome (eager AppShell import)', () => {
    const chrome = readFileSync(join(srcRoot, 'app/shell/ConnectedChrome.tsx'), 'utf8');
    expect(chrome).not.toMatch(/Cesium/);
  });

  it('does not re-export MiniMap from the components barrel', () => {
    const barrel = readFileSync(join(srcRoot, 'components/index.ts'), 'utf8');
    expect(barrel).not.toMatch(/from ['"]\.\/MiniMap['"]/);
  });
});
