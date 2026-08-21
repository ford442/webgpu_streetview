import { describe, expect, it } from 'vitest';
import { applyGltfInterior, isGltfInteriorEnabled } from '../gltfInteriorKit';

describe('glTF interior kit flag', () => {
  it('is off by default (procedural interiors, no main-chunk assets)', () => {
    expect(isGltfInteriorEnabled()).toBe(false);
  });

  it('applyGltfInterior is a documented no-op until #222', () => {
    expect(() => applyGltfInterior({ GLTFLoader: class { loadAsync() { return Promise.resolve(null); } } }, null)).not.toThrow();
  });
});
