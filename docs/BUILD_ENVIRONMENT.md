# Build environment — reproducing a production build

A production bundle needs five tools at known versions. CI (`ci.yml`) and the Deploy workflow
install them; this page is how to get the same machine locally or in a container, and how to
tell exactly which one is missing.

```bash
npm run check:toolchain                 # names every missing/wrong tool and the command that fixes it
npm run check:toolchain -- --for build  # only what `npm run build` needs (also: verify | deploy)
```

| Tool | Version | Pinned by | Needed for | Install |
| --- | --- | --- | --- | --- |
| Node | **≥ 24** (CI/Deploy: 24) | `.nvmrc`, `package.json` `engines` | everything | `nvm install` (reads `.nvmrc`) |
| emcc (Emscripten) | **exactly `6.0.6`** | `cpp/emsdk.version` | `npm run build` (`build:wasm`) | `bash scripts/setup-toolchain.sh` |
| naga-cli | any recent (30.x used) | — (`--locked`) | `npm run verify` (WGSL validation); CI **fails** without it | `cargo install naga-cli --locked` |
| cmake + C++20 compiler | cmake ≥ 3.16; a compiler with `-std=c++20` incl. `std::span`/`std::bit_cast` (g++ 13.3 verified; CI pins clang 18 for lint) | `cpp/CMakeLists.txt` | `npm run verify` / `test:cpp` (native goldens) | `apt-get install cmake g++` |
| git | any | — | `build-info.json` records the commit | or set `SV_BUILD_SHA` |

For deploying: Python 3 and `pip install requests` (`python deploy.py`).

`build-wasm.sh` refuses any emcc but `cpp/emsdk.version`, because the shipped WASM must be
bit-reproducible: `verify` and CI compare the committed binaries to a pinned-emcc rebuild.

## From a bare Ubuntu 24.04 machine

```bash
sudo apt-get install -y git cmake g++ python3 python3-pip curl
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && . ~/.cargo/env   # Rust, for naga
nvm install && nvm use                                                   # Node 24 from .nvmrc
git clone https://github.com/ford442/webgpu_streetview && cd webgpu_streetview
bash scripts/setup-toolchain.sh                                          # emsdk 6.0.6 → ~/emsdk, naga-cli, then check:toolchain
source ~/emsdk/emsdk_env.sh
npm ci
npm run verify                                                           # the gate
npm run fetch:models                                                     # depth + semantic ONNX, SHA-256 pinned
npm run build                                                            # → build/ (verify-build.sh runs at the end)
```

`scripts/setup-toolchain.sh` is idempotent and only touches `$EMSDK_DIR` (default `~/emsdk`) and
`~/.cargo/bin`. Exercised on 2026-11-26 on an Ubuntu 24.04 container (Node 24.22, emcc 6.0.6, naga-cli 30.0.2,
cmake 3.28, g++ 13.3): `emsdk install 6.0.6`, `cargo install naga-cli --locked`, `npm ci`, `npm run verify` (13/13),
`npm run fetch:models` and `npm run build` (`verify-build.sh` passes; the emcc rebuild reported `public/wasm/ matches this build`).
The `apt-get`, `rustup` and `nvm` lines above are the standard installers and were not re-run there.

### Node-only containers (no emcc)

A container with Node 24 but no emsdk can still run `npm run build` when it is told to trust the committed
binaries: `CI=true SV_WASM_PREBUILT=1 npm run build`. `build-wasm.sh` then skips emcc **only if** the C++
source hash matches `public/wasm/streetview-wasm.wasm.sha256`; if the C++ changed it fails and asks for emcc.
CI's `test-and-build` job does exactly this and `build-wasm-emscripten` proves the binaries match a rebuild.
The Deploy workflow does **not** take this shortcut: it installs emsdk and rebuilds.

### Stock agent/dev containers

Many ship Node 22 and no emcc. `npm run check:toolchain` reports `Node ≥ 24 … v22.x` and the install line.
Do not work around it — Node 22 is below `engines`, and a build with a different emcc would not match the
committed WASM.

## A build with no `.git`

`build/build-info.json` must name a commit. Without a checkout (a Docker build context, a source tarball):

```bash
SV_BUILD_SHA=<40-hex commit> SV_BUILD_REF=main npm run build
```

`SOURCE_DATE_EPOCH` (seconds) pins `builtAt` for reproducible-build tooling.

## Build identity

Every build writes `build/build-info.json` and inlines the same object as `window.__SV__.build`:

```json
{ "sha": "891c1255a2f1…", "shortSha": "891c125", "version": "1.0.0-rc.0",
  "builtAt": "2026-11-26T09:34:53.508Z", "dirty": false, "ref": "main" }
```

- `sha` is the full commit; `dirty: true` means tracked files differed from it (`SV_REQUIRE_CLEAN=1` — set by the
  Deploy workflow — turns that into a build failure).
- `scripts/check-build-info.mjs` (run by `verify-build.sh`) checks the file against `package.json`, the checkout's
  `HEAD` and the main bundle.
- `npm run verify:live -- --url https://test.1ink.us/streetview/ --expect-sha <sha> --files` checks a **deployed** site:
  the live `build-info.json` SHA, COOP/COEP sent exactly once, and every built file present. The Deploy workflow runs it
  as its last step.
- It holds no env values — only the commit, version, time and branch name — so it passes `check-build-env-leak.mjs`.

## Hosting headers

Dev (`vite.config.ts`) and prod (`public/.htaccess`) both send COOP `same-origin` and COEP `credentialless`.
Never `require-corp` (it breaks the Maps embed). Each must arrive **once**: two COOP lines combine to
`same-origin, same-origin`, which is not a valid value, so Chromium ignores it and `crossOriginIsolated` is `false`
(verified in Chromium: `SharedArrayBuffer` is then undefined and the SAB audio path is off). `.htaccess` has to
unset the header in both of Apache's tables (`Header unset` *and* `Header always unset`) before setting it,
because a vhost-level plain `Header set` lives in the success-response table. If the duplicate comes from a
proxy in front of Apache, only the host's config can remove it.
