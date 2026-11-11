# Status

Task IDs from BUILD_PLAN. Claim a task by writing `in progress: <agent>` next to it.

## Step 0: Environment and repository

- [x] T0.1 Toolchain in WSL (Rust 1.95 + 1.86 wasm, cargo-near 0.23, near-cli-rs 0.31.1, Node 22, pnpm 10.8, shade CLI 2.4; Docker WSL integration on). `jq` is not installed (needs `sudo apt install jq`). Nothing in the repo needs it yet.
- [ ] T0.2 Accounts and keys (human: testnet root, NEAR AI, Phala, Stripe, Razorpay)
- [x] T0.3 Monorepo scaffold (Cargo workspace, pnpm workspace, Makefile, build script, docs)
- [x] T0.4 CI (`.github/workflows/ci.yml`). ESLint is not configured yet: `typecheck` + Prettier for now.
- [x] T0.5 STATUS.md, SPIKES.md

## Step 1: Contracts, scoring, sandbox demo

- [x] T1.0 Spikes SP1, SP1b, SP2, SP2b, SP3 (SP4 TEE part and SP10 deferred, see SPIKES.md)
- [x] T1.1 `contracts/shared`: messages, ext traits, errors, events, fx, Shade-compatible `AgentRegistry`
- [x] T1.2 `contracts/mock-usdc`
- [x] T1.3 `contracts/settlement`: single-leg routing, pendings, `unresolved` + lock-timeout recovery, ring buffer, test hooks
- [x] T1.4 `contracts/factory`: keyless accounts, embedded code, refund on failure, code hash view
- [x] T1.5 `contracts/credit`: vault and runUSDC, agents and roles, merchants, offers and bounds, disbursement state machine, periods/provisions/default/recovery, router, withdraw cooldown, owner/guardian, views, INR hooks (T1.5k)
- [x] T1.6 `contracts/tests`: sandbox harness and integration tests + invariants; `contracts/stub-gateway`
- [x] T1.7 `packages/scoring`: bigint formula, vectors (design §10.4 + demo series), properties
- [x] T1.8 `packages/sdk` (dual-RPC, NEP-413 + FullAccess check, typed views) and `packages/config` (profiles, fixtures)
- [x] T1.9 Local underwriter and `make sandbox-demo`
- [ ] Gate G1: `make lint`, `make test`, `make sandbox-demo` green in CI. Green locally (below); CI runs once the branch is pushed.

### Local results (2026-11-11, WSL2 Ubuntu)

| Check | Result |
| --- | --- |
| `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings` | clean |
| Contract unit tests | 29 passed (credit 19, settlement 6, mock-usdc 2, shared 2) |
| Sandbox integration tests (`contracts/tests/tests/flows.rs`, nearcore 2.14.0) | 16 passed: 14 in the last full run, plus S4 and V2/V9/V10, which were re-run on their own after their timing margins were widened (see below). One V2 re-run hung because the sandbox node stopped producing blocks for over 20 minutes; the next run passed in 765 s. This VM's clock is not NTP-synchronized (`timedatectl`), which is the likely cause. |
| TypeScript (`pnpm typecheck`, `pnpm test:ts`, `pnpm format:check`) | clean, all tests pass (scoring 19, sdk 7, config) |
| `make sandbox-demo` | `DEMO PASSED` (1,028 s on this machine) |

Sandbox timing: this WSL2 VM produces a block every 1.5–3.5 s of wall time, and a transaction takes 5–7 blocks. Tests that compare elapsed time or blocks against a limit now keep margins of several transactions: S4's lock timeout is 60 blocks (was 10), V2's period is 120 s (was 30 s), and V9's cooldown is 120 s, fast-forwarded before the loan exists.

### Test coverage notes

- Sandbox: T1, S1 (covers S3 in the single-leg design), S2, S4, S8, C1, C2, C6, C9, C13, C14, F1, F2, V2, V8, V9, V10, V14, P1, P2.
- Unit (no chain): S5 (stale callbacks), S10 (ring buffer), V1 (cumulative principal with dust), V3/V4 (default + capped recovery), V5 (late roll), V6 (inflation), V7, V12, V13, C4, C5, C7, C8, C10, C11, C12.
- Not automated yet: S6 (a deposit landing between `ft_balance_of` and the transfer can't be interleaved deterministically in the sandbox; covered by construction, since new inflow = balance − pendings), S7 (raw buckets include self-transfers by design; verified revenue comes from 1Click/INR receipts in Step 2/4b), S9 (late receipt after a lock timeout), C3 (callbacks for older loans; status checks are covered in unit tests).

## Step 2 onward

Not started. See BUILD_PLAN.
