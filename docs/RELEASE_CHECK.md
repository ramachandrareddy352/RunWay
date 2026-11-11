# Release check

BUILD_PLAN T6.2 and the manual tests W4–W9 (§7.3). Run before the repository goes public and again
before submitting. Record the date, the commit and every deviation; fix the README for any step that
didn't work exactly as written.

## 1. Fresh clone (T6.2)

In a clean WSL user (no `~/.cargo`, `~/.near`, `node_modules` or caches from this machine):

| Step | Command | Expected | Result |
|---|---|---|---|
| 1 | Install the toolchain from README "Prerequisites" | `rustc`, `cargo near`, `node 22`, `pnpm 10.8` on PATH | |
| 2 | `git clone … && cd runway && make setup` | `pnpm install` finishes | |
| 3 | `make lint` | fmt, clippy, Prettier and typecheck clean | |
| 4 | `make test` | wasm built, Rust unit + sandbox tests pass, TypeScript tests pass | |
| 5 | `make sandbox-demo` | ends with `DEMO PASSED` | |
| 6 | `make sandbox-demo-inr` | ends with `DEMO PASSED` and `DEMO (INR) PASSED` | |
| 7 | `res/CODE_HASHES.txt` | matches the hashes in the README and the CI artifact | |
| 8 | `git grep -nE "(PRIVATE_KEY\|rk_live\|rk_test\|ed25519:[1-9A-HJ-NP-Za-km-z]{40,})"` | only placeholders, docs and tests | |

Deviations:

-

## 2. Manual checklists (testnet; after deployment, Amendment A1 step 3)

Use a fresh testnet wallet for the merchant and another for the lender. Note the transaction hashes.

### W4: wallets (T5.1)
- [ ] Connect with each of Meteor, MyNearWallet, HOT and Intear; the header shows the account.
- [ ] `/merchant/capital` → "Sign and request an offer" opens a NEP-413 signature prompt with recipient `runway-underwriter`.
- [ ] A transaction (`/merchant` → Register) opens the wallet's confirmation with the attached deposit shown.
- [ ] Sign out and back in; the page state follows.

### W5: merchant (T5.2)
- [ ] Register a handle; the deposit shown equals `pay.<root>.required_deposit()`.
- [ ] The settlement account exists with 0 access keys (`/audit/offer/<id>` once an offer exists, or NearBlocks).
- [ ] The payment link and QR open `/pay/<handle>?amount=…`.
- [ ] After a SIMULATED payment, the revenue chart shows the bucket (current bucket lighter, "in progress").
- [ ] With an active loan: the loan card and repayment bar update after the next settle.
- [ ] `update_payout` to another registered account works; `claim_payout` is disabled at 0 claimable.

### W6: capital (T5.3)
- [ ] The underwriter card says "session key matches chain".
- [ ] Without a Stripe key: an unanchored offer (or a decline with a reason).
- [ ] With an `rk_test_…` key: reasons say "Stripe test mode, not real KYC" and the offer uses anchored caps.
- [ ] With a CSV statement and no NEAR AI key on the agent: "statements skipped: NEAR AI not configured".
- [ ] The offer card shows "commitment verified".
- [ ] Accept: the state row moves PendingTerms → PendingTransfer → Active, and USDC (or ₹ in INR mode) arrives.

### W7: lend (T5.4)
- [ ] Register share storage, deposit USDC; runUSDC appears.
- [ ] Request a withdrawal; the countdown runs; Claim fails before `ready`, succeeds after.
- [ ] Cancel returns the shares.
- [ ] NAV, share price, utilization, provisions and reserve match `credit.get_vault()`.

### W8: audit (T5.5)
- [ ] `/audit/offer/<id>`: every bound check is ✔ for a real offer; the role is Underwriter.
- [ ] "Load from this browser" + "Recompute commitment" → matches (on the browser that requested the offer).
- [ ] Editing one character of the pasted inputs → does not match.
- [ ] The settlement code hash equals the factory hash; 0 access keys.

### W9: exit app (T5.6)
- [ ] Stop the API, the underwriter and the gateway.
- [ ] Open `apps/exit/dist/exit.html` (or the IPFS CID); set the RPC.
- [ ] View the merchant and its settlement state; `settle()`; `claim_payout()`.
- [ ] `claim_withdraw()` and `cancel_withdraw()` on a request; `check_loan()` on a loan.

### X2 / X5: recorded runs
- [ ] X2: register → pay (SIMULATED) → capital → accept → repay → withdraw, all in the UI. Screen capture saved.
- [ ] X5: SIMULATED UPI sale → split → ₹ payout Paid; investor ₹ deposit → shares; ₹ withdrawal → Paid. Links recorded.
