/**
 * Optional glTF interior kit — reserved for #222.
 *
 * Enable with `?gltfInterior=1`. Until `applyGltfInterior` is wired, the flag
 * is a documented no-op: cabins stay procedural and GLTFLoader is not imported,
 * so `scripts/check-bundle-budget.sh` stays green. Do not fire-and-forget
 * `loadGltfInteriorKit()` from bootstrap.
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

/**
 * Dynamic import of Three's GLTFLoader — call only from applyGltfInterior (#222).
 * Not invoked from CarInteriorBootstrap today.
 */
export async function loadGltfInteriorKit(): Promise<GltfInteriorKit | null> {
  if (!isGltfInteriorEnabled()) return null;
  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return { GLTFLoader: mod.GLTFLoader };
}

/**
 * Apply a loaded glTF kit onto the procedural cabin host.
 * #222 fills this in. Until then this is a documented no-op so callers
 * must not import GLTFLoader just to console.warn.
 */
export function applyGltfInterior(_kit: GltfInteriorKit, _host: unknown): void {
  // no-op until #222 wires hero interiors
}
