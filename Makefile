# Run inside WSL/Linux. Every target maps to a pnpm script or cargo command, so Windows users can
# run the same thing with `pnpm <script>` from WSL.
.PHONY: setup build test test-contracts test-ts sandbox-demo sandbox-demo-inr lint fmt fixtures

setup:
	pnpm install

build:
	bash scripts/build-contracts.sh

test: build test-contracts test-ts

test-contracts:
	cargo test --workspace -- --test-threads=4

test-ts:
	pnpm test:ts

sandbox-demo: build
	pnpm sandbox-demo

# The core demo followed by the INR rail steps 14-18 (BUILD_PLAN T4b.10).
sandbox-demo-inr: build
	pnpm sandbox-demo:inr

lint:
	pnpm lint

fmt:
	cargo fmt --all
	pnpm format

# Regenerate packages/config/fixtures from the Rust types.
fixtures:
	UPDATE_FIXTURES=1 cargo test -p runway-integration-tests fixtures
