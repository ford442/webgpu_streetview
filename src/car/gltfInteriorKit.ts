/**
 * Optional glTF interior kit — feature-flagged, never in the main chunk.
 *
 * Enable with `?gltfInterior=1`. Default cabins stay procedural (zero extra
 * assets) so `scripts/check-bundle-budget.sh` stays green. Draco is not
 * pulled in; add it only if a future hero model requires it and the budget
 * still passes.
 */

export function isGltfInteriorEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('gltfInterior') === '1';
  } catch {
    return false;
  }
}

export interface GltfInteriorKit {
  GLTFLoader: new () => {
    loadAsync: (url: string) => Promise<unknown>;
  };
}

/** Dynamic import of Three's GLTFLoader — call only when the flag is on. */
export async function loadGltfInteriorKit(): Promise<GltfInteriorKit | null> {
  if (!isGltfInteriorEnabled()) return null;
  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return { GLTFLoader: mod.GLTFLoader };
}
