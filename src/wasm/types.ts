/** Shapes the WASM numeric layer owns: the ABI never imports a consumer for its own types. */

export interface LumaReduce {
  mean: number;
  min: number;
  max: number;
  count: number;
}
