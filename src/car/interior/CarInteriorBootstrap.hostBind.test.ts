import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), 'CarInteriorBootstrap.ts');

describe('CarInteriorBootstrap host bind order', () => {
  it('assigns microInteractions on the host before building the cabin', () => {
    const src = readFileSync(srcPath, 'utf8');
    const assignIdx = src.indexOf('host.microInteractions = microInteractions');
    const buildIdx = src.indexOf('buildInteriorFromBuilder(host)');
    expect(assignIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(buildIdx);
  });

  it('does not construct the unused EffectComposer post stack at cabin boot', () => {
    const src = readFileSync(srcPath, 'utf8');
    expect(src).not.toMatch(/new PostProcessingManager\s*\(/);
    expect(src).not.toMatch(/import \{ PostProcessingManager \}/);
  });
});
