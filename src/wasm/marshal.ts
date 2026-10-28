/**
 * src/wasm/marshal.ts
 * Shared linear-memory marshalling primitives for the WASM loader.
 * Per-export copy-in/copy-out wrappers stay in src/wasm/index.ts (each one is
 * tightly coupled to the raw exports and memory captured when the module was
 * instantiated); this file holds the one piece that's genuinely shared.
 */

/**
 * The shadow stack the build pins (`-s STACK_SIZE` in cpp/CMakeLists.txt;
 * wasmAbiLock.test.ts keeps the two equal). The loader refuses a binary whose
 * stack is any other size: #300's corruption was an assumption about it.
 */
export const WASM_STACK_SIZE = 64 * 1024;

/** Initial arena size; grown on demand (a 512² noise tile is 1 MiB). */
export const SCRATCH_INITIAL_BYTES = 64 * 1024;

/**
 * How long the arena may sit above {@link SCRATCH_INITIAL_BYTES} with no
 * reservation that needs it before it shrinks back.
 */
export const SCRATCH_IDLE_SHRINK_MS = 1000;

/** The clock the arena's idle shrink runs on — injectable for tests. */
export interface ScratchClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): void;
}

const defaultClock: ScratchClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  // Looked up per call, so a test's fake timers apply to arenas made before them.
  setTimeout: (callback, ms) => {
    globalThis.setTimeout(callback, ms);
  },
};

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
  /**
   * Free the block and re-malloc `bytes` when it is larger than that. WASM
   * memory itself never shrinks; this hands the region back to the allocator
   * so a one-off large input does not pin it. Runs on its own after
   * {@link SCRATCH_IDLE_SHRINK_MS} without a reservation above the default.
   */
  shrinkTo(bytes: number): void;
  /** Current block size in bytes. */
  readonly capacity: number;
  /** Largest reservation ever asked of this arena, in bytes. */
  readonly highWaterBytes: number;
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
 * Growth is on demand (power-of-two steps from the default); a block above
 * the default shrinks back after a second in which nothing needed more than
 * the default. The hot path pays one clock read per oversized reserve; the
 * check is a single `setTimeout` re-armed only while the arena is large.
 *
 * @param stackBase  Highest stack address (`emscripten_stack_get_base()`), when
 *                   the binary exports it. The arena must start at or above it;
 *                   a layout where it does not throws (and the load rejects)
 *                   rather than corrupt the stack.
 */
export function createScratchArena(
  malloc: (bytes: number) => number,
  free: (ptr: number) => void,
  stackBase?: number,
  clock: ScratchClock = defaultClock,
): ScratchArena {
  let base = 0;
  let capacity = 0;
  let highWater = 0;
  /** Last time a reservation needed more than the default. */
  let lastLargeAt = 0;
  let shrinkArmed = false;

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

  const release = (): void => {
    if (base !== 0) free(base);
    base = 0;
    capacity = 0;
  };

  const shrinkTo = (bytes: number): void => {
    if (capacity <= bytes && base !== 0) return;
    release();
    try {
      allocate(bytes);
    } catch {
      // Leave it empty: the next reserve() allocates (and throws there, on
      // the caller's stack, if malloc really is failing).
    }
  };

  const checkIdle = (): void => {
    shrinkArmed = false;
    if (capacity <= SCRATCH_INITIAL_BYTES) return;
    const idle = clock.now() - lastLargeAt;
    if (idle >= SCRATCH_IDLE_SHRINK_MS) {
      shrinkTo(SCRATCH_INITIAL_BYTES);
      return;
    }
    shrinkArmed = true;
    clock.setTimeout(checkIdle, SCRATCH_IDLE_SHRINK_MS - idle);
  };

  allocate(SCRATCH_INITIAL_BYTES);

  return {
    reserve(bytes: number): number {
      if (bytes > highWater) highWater = bytes;
      if (bytes > SCRATCH_INITIAL_BYTES) {
        lastLargeAt = clock.now();
      }
      if (bytes > capacity || base === 0) {
        // Contents need not survive: every wrapper copies in after reserving.
        release();
        let next = SCRATCH_INITIAL_BYTES;
        while (next < bytes) next *= 2;
        allocate(next);
      }
      if (capacity > SCRATCH_INITIAL_BYTES && !shrinkArmed) {
        shrinkArmed = true;
        clock.setTimeout(checkIdle, SCRATCH_IDLE_SHRINK_MS);
      }
      return base;
    },
    shrinkTo,
    get capacity() {
      return capacity;
    },
    get highWaterBytes() {
      return highWater;
    },
  };
}
