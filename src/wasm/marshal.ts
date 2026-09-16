/**
 * src/wasm/marshal.ts
 * Shared linear-memory marshalling primitives for the WASM loader.
 * Per-export copy-in/copy-out wrappers stay in src/wasm/index.ts (each one is
 * tightly coupled to the raw exports and memory captured when the module was
 * instantiated); this file holds the one piece that's genuinely shared.
 */

/**
 * Build a `reserveScratch(bytes)` closure that grows `wasmMemory` until
 * `bytes` are available past `offset`, in whole 64 KiB pages.
 */
export function createScratchReserver(
  wasmMemory: WebAssembly.Memory,
  offset: number,
): (bytes: number) => void {
  return (bytes: number): void => {
    const available = wasmMemory.buffer.byteLength - offset;
    if (available < bytes) {
      wasmMemory.grow(Math.ceil((bytes - available) / 65536));
    }
  };
}
