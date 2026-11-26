#!/usr/bin/env bash
# scripts/setup-toolchain.sh — install the pinned build tools that are not npm packages.
#
#   bash scripts/setup-toolchain.sh            emsdk (cpp/emsdk.version) + naga-cli, then `npm run check:toolchain`
#   EMSDK_DIR=/opt/emsdk bash scripts/setup-toolchain.sh
#
# Idempotent: a tool that is already at the pinned version is left alone. Needs network access to
# github.com, storage.googleapis.com (emsdk binaries) and crates.io (naga). It does NOT install Node
# (use nvm: `nvm install` reads .nvmrc), cmake or a C++ compiler (apt-get install cmake g++), because those
# belong to the OS — `npm run check:toolchain` tells you if one is missing. docs/BUILD_ENVIRONMENT.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/cpp/emsdk.version")"
EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"   # build-wasm.sh looks here by default

# ---- emsdk, pinned ---------------------------------------------------------
if [ ! -x "$EMSDK_DIR/emsdk" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
have_emcc=""
if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  have_emcc="$(bash -c "source '$EMSDK_DIR/emsdk_env.sh' >/dev/null 2>&1 && emcc --version 2>/dev/null | head -1" || true)"
fi
case "$have_emcc" in
  *" $EMSDK_VERSION "*) echo "emsdk $EMSDK_VERSION already active." ;;
  *)
    "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
    "$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"
    ;;
esac

# ---- naga-cli (WGSL validation) -------------------------------------------
if command -v naga >/dev/null 2>&1 || [ -x "$HOME/.cargo/bin/naga" ]; then
  echo "naga-cli already installed."
elif command -v cargo >/dev/null 2>&1; then
  cargo install naga-cli --locked
else
  echo "naga-cli missing and cargo not found — install Rust (https://rustup.rs), then: cargo install naga-cli --locked" >&2
fi

cat <<MSG

Activate in each new shell (build-wasm.sh also finds \$HOME/emsdk by itself):
  source "$EMSDK_DIR/emsdk_env.sh"
  export PATH="\$HOME/.cargo/bin:\$PATH"

MSG
PATH="$HOME/.cargo/bin:$PATH" bash -c "source '$EMSDK_DIR/emsdk_env.sh' >/dev/null 2>&1; cd '$REPO_ROOT' && node scripts/check-toolchain.mjs"
