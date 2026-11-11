# Runway

**Working capital for businesses paid in stablecoins, built on NEAR.**
Customers pay a merchant from any chain through NEAR Intents. An attested underwriter (TEE) prices
credit from the merchant's verified payment history. A fixed share of every payment routed through
the merchant's keyless settlement account then repays the loan automatically.

> Status: **Step 1 of the build plan is complete**. Contracts, deterministic scoring, SDK core,
> sandbox tests and the sandbox demo all run locally. The real 1Click payments, the Phala TEE agent,
> the INR rail and the web app come next.

## The problem
Freelancers, agencies and online sellers increasingly get paid in USDC/USDT, but:
- banks don't count crypto income,
- DeFi lending needs more than 100% collateral, which defeats the purpose of borrowing, and
- underwriting normally means handing a lender your revenue and customers.

Web2 solved this with revenue-based financing (Stripe Capital, Shopify Capital), because the lender
sits in the payment flow. Runway puts a **NEAR settlement contract** in that position.

## Try it (Linux or WSL)
```bash
make setup          # pnpm install
make build          # contracts → res/*.wasm (+ res/CODE_HASHES.txt)
make sandbox-demo   # full loop on a private local NEAR sandbox (nearcore 2.14.0, downloaded once)
```
The demo sends about 40 real transactions and fast-forwards the chain through seven 5-minute revenue
buckets. It takes 10–20 minutes, depending on the machine. Output (`NEAR_PRINT_LOGS=1` also prints every receipt log):
```
✔ sandbox started; contracts deployed
✔ local Underwriter agent agent.test.near registered (Shade local mode: whitelisted, mock measurements)
✔ lender deposited 10000.000000 USDC → 10000.000000 runUSDC
✔ owner seeded the first-loss reserve with 100.000000 USDC
✔ priya.pay.test.near created — access keys: 0, code hash <settlement wasm hash> (matches factory)
✔ 3 buckets of routed revenue: 3900 / 4000 / 4200 USDC (each settled 100% to Priya, no loan)
✔ offer #1 (revenue: sandbox-buckets, payers: unknown, anchor: sandbox fixture — not KYC): grade C, limit 500.000000, fee 10%, repay 5.00%
✔ loan #1 500.000000 disbursed (PendingTerms → PendingTransfer → Active); owed 550.000000
✔ loan #1 repaid automatically from routed payments (4000 / 4100 / 3900 USDC); loans_repaid = 1
✔ offer #2: grade B, limit 2000.000000, fee 7%, repay 17.84% (window 3900/4000/4200/4000/4100/3900)
✔ loan #2 2000.000000 Active; owed 2140.000000
✔ settle: 1000.000000 in → repay 178.400000 / payout 821.600000
✔ lender withdrew 1000.000000 runUSDC → 1005.549837 USDC (priced at claim, after the cooldown)
✔ invariants I1–I4, I2b, I6, I7 hold

DEMO PASSED
```
Run all tests with `make test` (contract unit tests, sandbox integration tests, TypeScript tests).

## Do X → see Y
| Do | See |
|---|---|
| `make sandbox-demo` | The full loop above ends with `DEMO PASSED` |
| `cargo test -p runway-integration-tests` | The sandbox scenarios pass. Their IDs are in `docs/STATUS.md`: failed repay leg retried as repayment, stuck lock recovered exactly once, disbursement state machine, INR hooks, provisions before withdrawals, … |
| `cargo test -p runway-credit` | Unit tests pass: cumulative principal with 107 dust repayments, late period roll into default, capped recovery, offer bounds, roles, anchors |
| `pnpm --filter @runway/scoring test` | Design §10.4 vectors match exactly, plus property tests |

## How it works
```
Customer (any chain) ── NEAR Intents 1Click ──► <handle>.pay.runway (keyless settlement)
                                                    │ settle(): one ft_transfer_call with the split
                                                    ▼
                                    credit.runway ── repay share → lender vault (runUSDC)
                                                  └─ merchant share → merchant (USDC, or ₹ via INR gateway)
Underwriter (TEE, Shade agent) ── submit_offer (role-gated, hard caps re-checked on-chain) ──► credit.runway
```

| Contract | Role |
|---|---|
| `contracts/credit` | Vault and `runUSDC` shares (virtual-offset math, withdrawal cooldown priced at claim), Shade-compatible agent registry with owner-assigned roles, offers with hard bounds, callback-gated disbursement, period rolling, provisions, default, capped recoveries, router with a monotonic per-settlement op receipt, INR payout hooks |
| `contracts/settlement` | Per-merchant account with **zero access keys**. Splits new inflow and sends one transfer to credit. Failed or unknown operations are retried or reconciled exactly (`unresolved`, lock timeout, `get_last_op`). |
| `contracts/factory` | Creates `<handle>.<factory>` with the embedded settlement code, no keys. Publishes the code hash. |
| `contracts/shared` | Messages, cross-contract traits, errors, events, INR↔USDC conversion, `AgentRegistry` |
| `contracts/mock-usdc`, `contracts/stub-gateway` | Test-only token and INR-gateway stand-in |
| `packages/scoring` | Deterministic credit formula (bigint fixed point) |
| `packages/sdk` | Dual-RPC agreement reads, NEP-413 verification with FullAccess-key check, typed views |
| `packages/config` | Network profiles (one source of truth), fixtures generated from the Rust types |

## What's private and what isn't
Routed payments, loan terms, repayments and credit records are **public on-chain**. Off-chain evidence
(identity anchor data, statements) stays inside the TEE, and only commitments go on-chain. The TEE
parts are Step 3–4 and not built yet.

## Security model and known limits
- Money moves only by contract rules, and every cross-contract step has a callback that checks its result.
- Settlement accounts are keyless with fixed code. A bug in that code can't be patched (mitigations: tests, small caps).
- Sybil wash-trading and payment diversion are **bounded by caps, not prevented**.
- The Shade Agent framework is not formally audited.
- Local mode (`requires_tee = false`) is for the sandbox only. `get_config().requires_tee` shows the mode on-chain.

## Tech and versions
Rust: `near-sdk` 5.26.1 (pinned for `shade-attestation` 0.2.0), wasm built with Rust 1.86.0, native
tests on 1.95.0, `cargo-near` 0.23.0, `near-workspaces` 0.24. TypeScript 5.9 on Node 22 with pnpm 10.8,
`near-workspaces` 5.0, `@noble/curves`, `@noble/hashes`, Vitest and fast-check. Both sandbox harnesses
run nearcore 2.14.0.
See `docs/SPIKES.md` for why the toolchain is split and why the JS harness pins its own sandbox binary (SP2b).

## Hackathon disclosures
Built for NEAR HACKATHON (2026-11). All code in this repository was written during the hackathon
window with AI assistance (Claude Code). Libraries used are listed above and in `Cargo.toml` and
`package.json`. Attestation verification follows the Shade Agent Framework contract template.

## License
MIT. See `LICENSE`.
