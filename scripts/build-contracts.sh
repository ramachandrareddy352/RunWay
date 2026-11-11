#!/usr/bin/env bash
# Builds every contract to wasm in dependency order and writes code hashes.
#   res/<crate>.wasm         release builds (what gets deployed)
#   res/test/<crate>.wasm    builds with the `test-hooks` feature (integration tests only, never deployed)
# Usage: bash scripts/build-contracts.sh [--release-only]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p res/test

# near-sdk 5.26.1 (pinned for shade-attestation, SP1) targets a nearcore protocol whose VM accepts
# wasm from rustc <= 1.86; cargo-near enforces this. Native tests and clippy use rust-toolchain.toml.
WASM_TOOLCHAIN="${WASM_TOOLCHAIN:-1.86.0}"

build() { # <crate dir> <out dir> [features]
  local dir="$1" out="$2" features="${3:-}"
  echo "==> building $dir ${features:+(features: $features)}"
  (cd "contracts/$dir" && cargo "+$WASM_TOOLCHAIN" near build non-reproducible-wasm --locked --no-abi \
      ${features:+--features "$features"} --out-dir "$ROOT/$out" >/dev/null)
}

# Release: settlement first, because the factory embeds res/runway_settlement.wasm.
build settlement res
build mock-usdc res
build factory res
build credit res
build stub-gateway res
build inr-gateway res

if [[ "${1:-}" != "--release-only" ]]; then
  # Test-hooks variants (factory embeds res/test/runway_settlement.wasm when built with test-hooks).
  build settlement res/test test-hooks
  build factory res/test test-hooks
  build credit res/test test-hooks
fi

# Code hashes (base58 sha256, the same format NEAR RPC reports as code_hash).
node "$ROOT/scripts/lib/code-hashes.mjs" "$ROOT/res" | tee "$ROOT/res/CODE_HASHES.txt"
