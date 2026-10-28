/**
 * src/wasm/bindExports.ts
 * Bind a binary's raw exports to the generated ABI table (abi.generated.ts),
 * checking every one is present with the arity cpp/include/streetview/abi.h
 * declares. An exported wasm function's `length` is its parameter count, so
 * this catches an added/dropped parameter at load time even in a browser that
 * cannot reflect wasm types; the full param/result *types* are locked at build
 * time (scripts/check-wasm-abi.mjs, wasmAbiLock.test.ts read the type section).
 */
import {
  WASM_ABI,
  type StreetViewDspExports,
  type StreetViewWasmExports,
  type WasmBinaryKind,
  type WasmExportName,
} from './abi.generated';

export interface BoundWasm<T> {
  fns: T;
  memory: WebAssembly.Memory;
}

/** The ABI rows a binary of this kind must export. */
export function abiExportNames(kind: WasmBinaryKind): WasmExportName[] {
  return (Object.keys(WASM_ABI) as WasmExportName[]).filter((name) =>
    (WASM_ABI[name].binaries as readonly WasmBinaryKind[]).includes(kind),
  );
}

export function bindWasmExports(exports: WebAssembly.Exports, kind: 'main'): BoundWasm<StreetViewWasmExports>;
export function bindWasmExports(exports: WebAssembly.Exports, kind: 'dsp'): BoundWasm<StreetViewDspExports>;
/** Throws one error listing every missing or wrong-arity export. */
export function bindWasmExports(
  exports: WebAssembly.Exports,
  kind: WasmBinaryKind,
): BoundWasm<StreetViewWasmExports | StreetViewDspExports> {
  const problems: string[] = [];
  const fns: Record<string, unknown> = {};
  for (const name of abiExportNames(kind)) {
    const fn = exports[name];
    const arity = WASM_ABI[name].params.length;
    if (typeof fn !== 'function') problems.push(`${name} missing`);
    else if (fn.length !== arity) problems.push(`${name} takes ${fn.length} params, abi.h declares ${arity}`);
    else fns[name] = fn;
  }
  const memory = exports['memory'];
  if (!(memory instanceof WebAssembly.Memory)) problems.push('memory not exported');
  if (problems.length > 0) {
    throw new Error(`WASM ABI mismatch (${kind}): ${problems.join('; ')}`);
  }
  return { fns: fns as unknown as StreetViewWasmExports, memory: memory as WebAssembly.Memory };
}
