import { describe, expect, it } from 'vitest';
import { isGltfInteriorEnabled } from '../gltfInteriorKit';

describe('glTF interior kit flag', () => {
  it('is off by default (procedural interiors, no main-chunk assets)', () => {
    expect(isGltfInteriorEnabled()).toBe(false);
  });
});
