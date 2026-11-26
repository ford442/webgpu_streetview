# Bundle-size baseline — 1.0 release train

Measured with `npm run report:bundle` (definitions in `scripts/bundle-report.mjs`). **Issue 4 (performance & hardening) measures against
this**: re-run the command after `npm run build` and compare with
`npm run report:bundle -- --compare docs/bundle-baseline.json`. Budgets are enforced by `scripts/chunks.json` via `verify-build.sh`;
this page is the *measured* state under them.

Reading it:

- **First load** is the static payload before the app can paint. The depth/semantic models are **not** in it — they are fetched on
  demand at run time (`build/models/`), and are ≈ 56 of the ≈ 60 MiB the Deploy uploads, which is why `deploy.py` uploads in parts.
- Headroom to watch: **`three.core` is at 99 % of its 100 kB gzip budget** (99.5 / 100.0 kB) and `three.webgpu` at 80 %; the main
  chunk is at 76 % of 400 kB. Any change that touches three.js imports can fail `verify-build.sh` on the budget alone.
- The main chunk still bundles the Supabase client (`GoTrueClient` 63 kB, `phoenix` 26 kB, `storage-js` 22 kB, `postgrest-js` 16 kB raw — 126 kB between them) and `piexifjs`
  (30 kB raw) — candidates for Issue 4, measured with `npm run analyze`.
- gzip is `gzip -9` of the file (the budget script uses the default level, so its main number is ~0.5 kB lower); the host's real content
  encoding for `.wasm`/`.wgsl` was not measured here.

Built 2026-11-26T09:34:53.508Z · `891c1255a2f120fae1ebe173fcd4706d5ddcc71c`

## First load (static payload before the app can paint)

| part | gzip |
| --- | ---: |
| main JS + its static imports | 302.7 kB |
| CSS | 6.1 kB |
| index.html + config.js | 2.3 kB |
| main-thread WASM (boot needs it) | 28.9 kB |
| **initial total** | **340.0 kB** |

Main chunk alone: 302.7 kB gzip of a 1021.6 kB file — budget 400.0 kB (76% used).

## Lazy chunks vs `scripts/chunks.json`

| chunk | gzip | budget | used |
| --- | ---: | ---: | ---: |
| three.webgpu | 160.2 kB | 200.0 kB | 80% |
| three.core | 99.5 kB | 100.0 kB | 99% |
| createCabinRenderer | 78.7 kB | 100.0 kB | 79% |
| carModeRuntime | 49.2 kB | 140.0 kB | 35% |
| tz | 28.9 kB | 100.0 kB | 29% |
| CarModeView | 24.4 kB | 100.0 kB | 24% |
| GLTFLoader | 13.0 kB | 100.0 kB | 13% |
| TripPlannerPanel | 5.5 kB | 100.0 kB | 5% |
| CoverageMap | 5.2 kB | 100.0 kB | 5% |
| WebGL2FallbackRenderer | 5.2 kB | 100.0 kB | 5% |
| GlobeView | 4.5 kB | 100.0 kB | 4% |
| cabinTslMaterials | 4.2 kB | 100.0 kB | 4% |
| SemanticController | 2.5 kB | 100.0 kB | 2% |
| AtmosphereController | 2.3 kB | 100.0 kB | 2% |
| performance | 1.4 kB | 100.0 kB | 1% |
| windshieldWetMask | 1.2 kB | 100.0 kB | 1% |
| globeInput | 1.1 kB | 100.0 kB | 1% |

## WASM, workers, models

| file | bytes | gzip |
| --- | ---: | ---: |
| wasm/streetview-dsp.simd.wasm | 20,808 | 8.2 kB |
| wasm/streetview-wasm.simd.wasm | 66,564 | 28.9 kB |
| static/js/depthWorker.C1Ykp7A2.worker.js | 8,549 | 3.5 kB |
| models/depth/depth-anything-v2-small.q4.onnx (on demand) | 27,404,416 | — |
| models/depth/depth-anything-v2-small.q4f16.onnx (on demand) | 19,126,267 | — |
| models/semantic/ddrnet23-slim-street7.onnx (on demand) | 11,820,427 | — |

## Everything the Deploy uploads

71 files · 60.18 MB raw · ≈ 57.86 MB transfer with gzip (≈ 2.22 MB without the on-demand models).

