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

## Step 2: Payments (testnet, simulated settlement)

- [x] T2.0 SP5: not run (Amendment A1). SP16 replaces it: dry quotes only on testnet.
- [x] T2.1 `@runway/sdk` 1Click client and `verifyQuote` / `verifyDeposit` (SD4–SD6)
- [x] T2.2 `apps/web` and `/pay/[handle]`: dual-RPC merchant lookup, asset picker with chain minimums, refund-address validation, browser-side 1Click quote with the live checklist, 7-status timeline, SIMULATED testnet payment (W1–W3)
- [x] T2.3 `services/api`: payment log, keeper, `/dev/simulate-payment` (A1–A4)
- [x] T2.4 Testnet deployment (2026-11-12): `scripts/deploy-testnet.ts` (idempotent, `--verify`). Accounts, code hashes and transactions in `deployments/testnet.json` and docs/RUNBOOK.md.
- [x] T2.5 removed (Amendment A1)
- [x] Gate G2 (sandbox): SD4–SD6, A1–A4, W1–W3 pass; the simulated payment → keeper → settle flow passes in `make sandbox-demo`.

## Step 3: TEE underwriter (local mode)

- [x] T3.1 `tee/underwriter` (Dockerfile, deployment.yaml, endpoints hardcoded per network, secrets-only env). The Shade template wasn't copied: `@neardefi/shade-agent-js` 2.2.0 is used directly (`packages/agent-kit/src/boot.ts`). `deployment.yaml` uses the keys `shade` CLI 2.4.0 parses (checked in its `config.js`), with every TEE step disabled.
- [x] T3.2 Boot, registration, session key rotation; browser-side `checkSession` (E1, E2)
- [x] T3.3 `/underwrite` pipeline (E3–E7)
- [x] T3.4 local half: `uwagent.runway-rama.testnet` registered in Shade local mode (whitelisted, mock measurements, role Underwriter). Agents sign with a key from env (`keySigner`); the TEE half (ShadeClient + Phala) needs free Phala credits and the human's go-ahead.
- [x] T3.5 `/verify` page
- [ ] Gate G3: E1–E7 pass. "A real TEE agent on testnet" waits for T3.4; the same flow passes on the sandbox (`make sandbox-demo` requests both offers through the sealed pipeline).

## Step 4: Evidence

- [x] T4.0 SP6 (deferred: needs the human's Stripe key), SP7 (deferred: needs Phala), SP8 (**passed live** against NEAR AI Cloud)
- [x] T4.1 Stripe anchor (E8–E10)
- [x] T4.2 NEAR AI attestation verification (E11–E13)
- [x] T4.3 Statement extraction, signature check and receipt hash (E14, E15)
- [ ] Gate G4: E8–E15 pass. The "/audit shows anchor ✔ and statement ✔" part needs a deployment, a Stripe test key and a NEAR AI key.

## Step 4b: INR rail

- [x] T4b.0 SP11–SP15 recorded (SP13 checked live)
- [x] T4b.1 `contracts/inr-gateway` (23 unit tests)
- [x] T4b.2 Sandbox tests G1–G13, I8; C13, C14, V13, V14 against the real gateway (`contracts/tests/tests/inr.rs`, 3 tests, 1,123 s)
- [x] T4b.3 `@runway/fx` (SC5, E19, E25) and the Indian-exchange sources
- [x] T4b.4–T4b.7 `tee/inr-gateway`: providers, collects, pay-ins, payouts, beneficiaries (E16–E18, E20–E24)
- [x] T4b.8 Underwriter INR receipts and Razorpay anchor (E26, E27)
- [x] T4b.9 Web: UPI tab, ₹ deposit/withdraw, settings, INR audit tables (W10–W12)
- [x] T4b.10 `make sandbox-demo-inr` (X4): `DEMO (INR) PASSED`
- [x] T4b.11 local half: `inr.runway-rama.testnet` deployed with a 5,000 USDC float, `gwagent` registered with role InrGateway, mock provider (RazorpayX signup unavailable)
- [ ] Gate G4b: all listed tests and X4 pass; the recorded testnet runs wait for deployment.

## Step 5: Product surfaces

- [x] T5.1 Wallets (wallet-selector 10.1.4: Meteor, MyNearWallet, HOT, Intear); W4 is a manual checklist
- [x] T5.2 `/merchant`; T5.3 `/merchant/capital`; T5.4 `/lend`; T5.5 `/audit`, `/audit/offer/[id]` (W5–W8: manual checklists in docs/RELEASE_CHECK.md)
- [x] T5.6 `apps/exit` → single-file `exit.html` (W9 manual). IPFS pinning and `set_exit_app_cid` wait for deployment and the human's pinning credentials.
- [ ] Gate G5: the recorded UI-only testnet run waits for deployment.

## Step 6: Ship

- [x] T6.1 README rewritten to the T6.1 outline
- [ ] T6.2 Fresh-clone check: the procedure is in docs/RELEASE_CHECK.md; not yet run in a clean WSL user
- [x] T6.3 Video script and click checklist (docs/VIDEO.md); the human records it
- [x] T6.4 X post draft (docs/X_POST.md); the human posts it
- [x] T6.5 `scripts/submit-payload.ts`: validates, prints, waits for "yes", never submits twice. Not run.

## Local results (2026-11-11, round 2)

| Check | Result |
| --- | --- |
| Contract unit tests | all pass (credit 19, inr-gateway 23, settlement 6, mock-usdc 2, shared 2) |
| INR sandbox tests (`tests/inr.rs`) | 3 passed in 1,123 s |
| `make sandbox-demo-inr` | `DEMO PASSED` and `DEMO (INR) PASSED` in 374 s |
| TypeScript | sdk 27 (+1 live test skipped), fx 16, scoring 19, config 2, api 8, underwriter 20, inr-gateway 17, web 13 (W1–W3, W10–W12) |
| Typecheck, Prettier, cargo fmt, clippy | clean |

Found by W1: the quote checklist echoed the deposit address in its detail text even when other checks failed, so a payer could copy an address from a tampered quote. `verifyQuote` now reports only "present"; the address appears only after every check and the status re-read pass.

The web tests run on happy-dom with thread workers: jsdom 31 (which loads a native canvas module) timed out starting workers over the WSL `/mnt/c` mount.

## Round 3 (2026-11-12): testnet

| Check | Result |
| --- | --- |
| `deploy-testnet` | `DEPLOYMENT OK`: 4 contracts (hashes match `res/CODE_HASHES.txt`), vault seeded, 2 local agents registered, float 5,000 USDC, priya registered (0 keys) |
| `pin-exit` | exit page on IPFS `bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4`, recorded with `set_exit_app_cid` |
| `services/node` on testnet | API + keeper, underwriter and gateway on one port; both agents registered; live FX ₹100–102.6 |
| `testnet-e2e` | `TESTNET E2E PASSED`: 3 buckets settled by the keeper; sealed offer (grade C, 100 USDC, unanchored cap), commitment verified; loan Active, repaid from two routed payments; UPI sale at the live rate settled; merchant ₹ payout Paid; investor ₹ deposit → shares and ₹ withdrawal Paid |
| Web data layer, live (`apps/web/test/live-testnet.test.ts`, opt-in) | 4 passed: two-RPC merchant lookup, vault, both session checks, payout history |
| NEAR AI (`tee/underwriter/scripts/nearai-live.ts`) | Verified private inference live: attestations, chat, provider_tee signature over the exact bytes, receipt hash (earlier the key returned HTTP 402 until credits were added) |

Fixed this round:
- `rpc.testnet.near.org` now answers HTTP 429 "THIS ENDPOINT IS DEPRECATED"; the second testnet RPC is dRPC (`near-testnet.drpc.org`), next to FastNEAR. The web app uses both only for reads that gate an action and FastNEAR alone for display reads.
- Blank variables in `.env` (for example `RAZORPAYX_ACCOUNT_NUMBER=`) failed validation; they now count as unset.
- Nothing settled a delivered UPI sale: the gateway now reports it to the API (`POST /payments/upi`, test A5) and the keeper settles it.
- Offers were read back at the final block before it included them; the web app and the E2E now wait for the final block.
- The mock UPI page's redirect ignored the mount path.
