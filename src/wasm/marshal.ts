/**
 * src/wasm/marshal.ts
 * Shared linear-memory marshalling primitives for the WASM loader.
 * Per-export copy-in/copy-out wrappers stay in src/wasm/index.ts (each one is
 * tightly coupled to the raw exports and memory captured when the module was
 * instantiated); this file holds the one piece that's genuinely shared.
 */

/** Initial arena size; grown on demand (a 512² noise tile is 1 MiB). */
export const SCRATCH_INITIAL_BYTES = 64 * 1024;

/** A kernel scratch region allocated from the module's own heap. */
export interface ScratchArena {
  /**
   * Make sure at least `bytes` of scratch are available and return its base
   * pointer (8-byte aligned, so f64 views at the base are naturally aligned).
   *
   * May call `malloc`, which may grow — and so detach — `memory.buffer`:
   * create typed-array views only *after* this returns, never before.
   */
  reserve(bytes: number): number;
}

/**
 * Build the scratch arena every kernel wrapper writes its inputs and outputs
 * into. It is a block from the module's exported `malloc`, so it lives in the
 * heap — above C++ statics and above the shadow stack.
 *
 * It used to be a fixed 64 KiB offset. The emcc stack grows *down* from
 * __stack_pointer's initial value (70848 in the binary that shipped then), so
 * the top ~5 KiB of stack sat inside the scratch region and libm's sin/cos
 * frames corrupted batch_haversine inputs for routes at |lat| > 45°.
 *
 * @param stackBase  Highest stack address (`emscripten_stack_get_base()`), when
 *                   the binary exports it. The arena must start at or above it;
 *                   a layout where it does not throws, and the loader falls back
 *                   to the JS twin rather than corrupt the stack.
 */
export function createScratchArena(
  malloc: (bytes: number) => number,
  free: (ptr: number) => void,
  stackBase?: number,
): ScratchArena {
  let base = 0;
  let capacity = 0;

  const allocate = (bytes: number): void => {
    const ptr = malloc(bytes);
    if (ptr === 0) throw new Error(`WASM scratch: malloc(${bytes}) failed`);
    if ((ptr & 7) !== 0) {
      free(ptr);
      throw new Error(`WASM scratch: malloc returned unaligned pointer ${ptr}`);
    }
    if (stackBase !== undefined && ptr < stackBase) {
      free(ptr);
      throw new Error(
        `WASM scratch: arena ${ptr} is below the stack base ${stackBase} — kernels would overwrite the C++ stack`,
      );
    }
    base = ptr;
    capacity = bytes;
  };

  allocate(SCRATCH_INITIAL_BYTES);

  return {
    reserve(bytes: number): number {
      if (bytes > capacity) {
        // Contents need not survive: every wrapper copies in after reserving.
        free(base);
        base = 0;
        capacity = 0;
        let next = SCRATCH_INITIAL_BYTES;
        while (next < bytes) next *= 2;
        allocate(next);
      }
      return base;
    },
  };
}
