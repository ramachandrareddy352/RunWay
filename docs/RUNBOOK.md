# Runbook

Record every deployment here: accounts, transaction hashes and code hashes (BUILD_PLAN §8).

## Sandbox (local)

No accounts, keys or funds. Run everything inside WSL/Linux:

```bash
make setup          # pnpm install
make build          # bash scripts/build-contracts.sh  → res/*.wasm, res/test/*.wasm, res/CODE_HASHES.txt
make test           # contract unit tests + sandbox integration tests + TypeScript tests
make sandbox-demo   # full loop on a private sandbox; prints DEMO PASSED
```

Toolchain: Rust 1.95.0 (native, from `rust-toolchain.toml`), Rust 1.86.0 with `wasm32-unknown-unknown` (contract wasm), `cargo-near` 0.23.0, Node 22, pnpm 10.8.0. See BUILD_PLAN T0.1.

## Testnet

Not deployed yet (T2.4).

## Mainnet

Not deployed. Human-gated (T2.5).
