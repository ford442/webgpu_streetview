# scripts/

Everything here is run through `npm run <name>` (see `package.json`) unless noted.
`tsc -b` type-checks the `.mjs` files through JSDoc (`tsconfig.scripts.json`).

## The gate

| Script | What it does |
| --- | --- |
| `verify.mjs` | `npm run verify` — the one gate CI, deploy and the pre-push check run: install, typecheck, ratchets, lint, docs, WASM ABI, knip, secrets, tests, WGSL, C++ goldens. `--fast`, `--bail`, `--no-cpp`. |
| `check-install.mjs` | node_modules matches `package.json` and Node meets `engines`. |
| `check-architecture.mjs` | the layering gate: `architecture.json` whole, dependency-cruiser (cycles, upward imports, orphans), lazy chunk entries not statically reachable from `src/index.tsx`, every `import()` has a contract in `chunks.json`. |
| `check-chunk-graph.mjs` | `build/chunk-graph.json` (written by `vite build`) against `chunks.json`: forbidden modules per chunk, singletons, lazy entries. Run by `verify-build.sh`. |
| `check-test-env.mjs` | DOM specs carry a jsdom pragma. |
| `check-deploy-secrets.sh`, `check-build-env-leak.mjs`, `public-env-keys.json` | no committed secrets; only listed env keys reach the bundle. |
| `validate-shaders.mjs` | WGSL through `naga`. |
| `hooks/pre-commit` | optional gitleaks guard (`npm run hooks:install`). |

## Build and deploy

| Script | What it does |
| --- | --- |
| `prebuild-env.mjs`, `gen-weather-post-shader.mjs` | run by `npm run build` before Vite. |
| `stamp-sw.mjs`, `sw-manifest.mjs` | stamp `build/service-worker.js` with the asset cache id. |
| `verify-build.sh`, `check-bundle-budget.sh` | post-build checks (stamped worker, wasm present and current, bundle budget, env-leak). |
| `check-maps-key.sh` | `npm run validate:maps-key` helper. |
| `fetch-depth-model.mjs` | deploy-time scene-depth model (`npm run fetch:depth-model`). |

## WASM / C++ (see `docs/WASM_BRIDGE.md`)

`build-wasm.sh` (emcc, pinned by `cpp/emsdk.version`), `wasm-source-hash.mjs`, `gen-wasm-abi.mjs`, `check-wasm-abi.mjs`, `check-wasm-features.mjs`, `wasm-binary.mjs`, `strip-wasm-exports.mjs`, `gen-wasm-goldens.mjs`, `bench-cabin-dsp.mjs`, `lint-cpp.sh`, `fuzz-cpp.sh`, `test-wasm-sanitizers.sh`.

## Generators and capture tools

`gen-flags-doc.mjs` (docs/FLAGS.md), `gen-structure-doc.mjs` (AGENTS.md tree), `gen-look-luts.mjs`, `author-sedan-cabin.mjs`, `capture-look-goldens.mjs`, `capture-depth-looks.mjs`, `capture-cabin-look.mjs`, `hold-pause-probe.mjs` (Playwright probes; need a browser and a Maps key where noted in the file header).

## Other

`git.sh` (repo root) is the supported commit helper; `commit_and_push.ps1` is a Windows convenience that stages everything — review `git status` first. `f16-naga-spike.wgsl` is a kept naga experiment; `fixtures/` holds script inputs.
