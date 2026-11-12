# Runway test plan (testnet)

A step-by-step script for testing every flow of the live testnet deployment by hand, with the result each
step should give. It covers USDC and rupee (INR) payments at every stage: the merchant, the loan, the
lender and the exit page. Run it top to bottom once; it takes about 90 minutes, most of it waiting for
5-minute revenue windows.

Everything is **SIMULATED**: USDC is a mock token and UPI is a mock provider. No real money moves. Every
contract call is real and visible on [NearBlocks](https://testnet.nearblocks.io).

| What | Where |
|---|---|
| Web app | https://runway-dusky.vercel.app |
| Backend (health) | https://runway-node.onrender.com/ |
| Exit page (IPFS) | https://ipfs.filebase.io/ipfs/bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4 |
| Contracts | `credit.runway-rama.testnet`, `pay.runway-rama.testnet`, `inr.runway-rama.testnet`, `musdc.runway-rama.testnet` |

## Before you start

**Things that trip testers up.**

1. **Get test USDC first** (test B2), even as a merchant. It also registers your wallet with the mock
   USDC token. A wallet that isn't registered can't receive USDC: your share of a payment then waits as
   "Claimable", and a loan can't be paid out, so it ends as **Failed**.
2. **Revenue windows are 5 minutes of wall-clock time:** :00–:05, :05–:10, :10–:15 and so on (the same
   minutes in IST). An offer needs revenue in **3 completed windows**, so make **exactly one 400 USDC
   payment in each of 3 windows in a row**, using the **Crypto** tab. Pay early in a window (in its first
   3 minutes). Ask for the offer **in the very next window**: for example, pay at 10:01, 10:06 and 10:11,
   then ask between 10:15 and 10:20. Asking later adds an empty window; so do different amounts or a
   skipped window. Revenue then looks unsteady and the offer is declined with "score … below 40". If that
   happens, keep making one 400 payment per window and ask again.
   Make UPI sales only after you have the offer: every simulated UPI payment comes from the same payer, so
   revenue built from UPI alone is declined as "revenue too concentrated in one payer".
3. **Repay the loan right away.** Testnet loan periods are 5 minutes. Each period must repay at least 10%
   of what is owed (11 USDC on a 110 USDC loan). Missing one period makes the loan **Delinquent**, and
   missing two makes it **Defaulted**; a merchant with a default never gets another offer.
4. **Pages don't refresh themselves** after the keeper settles a payment (every 15 seconds). Wait about
   30 seconds, then reload.
5. **The backend sleeps after 15 idle minutes** (free hosting). The first request then takes up to a
   minute. If a page shows a network error or "check failed", wait a minute and reload.
6. Messages signed with your wallet ("Sign and request an offer", registering a UPI ID) cost nothing.
   Transactions ask for approval and use a little testnet NEAR.

**Record as you go:** your handle, offer id, loan id, withdrawal request ids and payout ids. The
[results sheet](#results-sheet) at the end has a row for every test.

**Time-saving order:** start Part D (the three revenue windows) early, and run Part C (lender) and Part A
while you wait between payments.

---

## Part A: Look around without a wallet (5 minutes)

| ID | Do | Expected |
|---|---|---|
| A1 | Open https://runway-node.onrender.com/ | JSON with `"ok":true`, `"service":"runway-node"`, agents `uwagent.runway-rama.testnet` and `gwagent.runway-rama.testnet`, `"inr_provider":"mock"`. A first request can take up to a minute (wake-up). |
| A2 | Open https://runway-dusky.vercel.app | Home page "Runway" with the SIMULATED banner and the "Try it on testnet" card. No Vercel login page. |
| A3 | Open `/verify` | Two cards, **Credit contract (Underwriter)** and **INR gateway contract (InrGateway)**, each with a yellow **local mode** badge, one approved image hash (→ Underwriter, → InrGateway), "PPIDs: 1", the whitelisted agent, and "attestation lifetime 168 h". Then **Underwriter** and **INR gateway** cards, each with a green **session key matches chain** badge, the agent account and role, "Valid until …" (a date in the future) and the session key with its expiry. |
| A4 | Open `/lend` (not connected) | **Vault** card: Total assets (NAV) about 10,009 USDC, Share price about 1.000899, Utilization 0.00%, Outstanding principal 0.00, Provisions 0.00, First-loss reserve about 101 USDC. (These change as people test.) A **Connect wallet** button below. |
| A5 | Open `/audit/offer/2` | **Terms**: Grade C, Limit 100.00, Fee 10.00%, plus a repay share. **Contract bounds, re-checked here**: every row ✔. **Who made it**: ✔ approved image with role Underwriter, ✔ registration valid now, and ✖ "Contract requires a TEE: no: local mode (testnet, Amendment A1)". That ✖ is expected on testnet. **Settlement account**: ✔ code hash equals the factory's, ✔ no access keys. |
| A6 | Open `/audit` | **Active loans** table ("None." if nobody has a loan). Under **INR rail for a merchant**, enter `e2ed573wq` (the merchant from the scripted end-to-end run) and click **Show**: two UPI receipts of ₹8,500.00 with their rates, USDC delivered and status Delivered, and rupee payouts with status Paid and a UTR hash. |
| A7 | Open the exit page link | "Runway exit" page with RPC URL and credit contract already filled in, and Merchant, Loan, Withdrawal and Vault sections. |
| A8 | Open `/pay/nosuchhandle` | "Not found: There is no Runway merchant called “nosuchhandle”." |

## Part B: Wallet and test USDC (5 minutes)

| ID | Do | Expected |
|---|---|---|
| B1 | Install Meteor Wallet (browser extension), switch it to **Testnet**, create an account, and get testnet NEAR from https://near-faucet.io. Get **at least 4 NEAR**. On the site, click **Connect wallet** in the header and choose Meteor. | The header shows your account (for example `yourname.testnet`) and a sign-out button. |
| B2 | `/lend` → **Get 1,000 test USDC** | No wallet prompt (the backend mints it). After a few seconds the line reads "Wallet: 1,000.00 mock USDC" (more if you had some). |
| B3 | Click **Get 1,000 test USDC** again within 10 minutes | Error: "this account got test USDC in the last 10 minutes". The balance doesn't change. |

A wallet for testing without the faucet: import `tester.runway-rama.testnet` (key in `local/TESTNET_ACCOUNTS.md`,
not in git) via Meteor → Import wallet → Private key. It already has NEAR and mock USDC and is registered.

## Part C: Lender, in USDC (10 minutes)

| ID | Do | Expected |
|---|---|---|
| C1 | `/lend` → **Register share storage (0.01 NEAR)** → approve in the wallet | The button is replaced by an **Amount (USDC)** field and a **Deposit** button. |
| C2 | Amount `200` → **Deposit** → approve | Deposit card header: about **199.82 runUSDC** (200 ÷ share price). Wallet line: 200 USDC less. Vault NAV: about 200 more. |
| C3 | **Withdraw USDC** → Shares `50` → **Request withdrawal** → approve | A row `#<id> 50.00 shares Usdc ready in 120s` with **Claim** and **Cancel**. Shares go down by 50. |
| C4 | Click **Claim** before the countdown ends | The transaction fails with `ERR_COOLDOWN`. Nothing moves. |
| C5 | When the row shows **ready**, click **Claim** → approve | The row disappears. Wallet: about **50.04 USDC** more (50 × the share price at claim time). |
| C6 | Request a withdrawal of `10` shares, then click **Cancel** → approve | The row disappears and the 10 shares come back. |

## Part D: Merchant, in USDC (about 25 minutes, mostly waiting)

| ID | Do | Expected |
|---|---|---|
| D1 | `/merchant` → handle (2–32 lowercase letters or digits, for example `ramatest1`) → **Register ramatest1** → approve (about 2 NEAR deposit) | Page heading `ramatest1` with the badge **payouts in USDC**. **Payment link** card with a QR code and a link. **Routed revenue** empty. **Loan**: "No active loan. Ask for an offer." **Credit record**: 0 / 0 / 0.00 / 0.00. **Payout**: Claimable 0.00. On NearBlocks, `ramatest1.pay.runway-rama.testnet` exists and has **no access keys**. |
| D2 | Try registering the same handle from another wallet | The transaction fails with `ERR_HANDLE_TAKEN`. |
| D3 | In **Payment link**, set Amount (USDC) to `400` and open the link (`/pay/ramatest1?amount=400`) | "Pay ramatest1" and "Settles to `ramatest1.pay.runway-rama.testnet` (a keyless account; read from two RPCs)". **Crypto** and **UPI (₹)** tabs. |
| D4 | Crypto tab → **Pay with** "USDC on base" → refund address `0x52908400098527886e0f7030069857d2e4169ee7` (or any EVM address of yours) → **Get quote** | "You send about 404.xx USDC" (a live mainnet price preview) and a checklist: ✔ Quote signed by 1Click, ✔ Quote type, ✔ Pays the merchant's settlement account, ✔ Delivers USDC on NEAR, ✔ Delivers at least the invoice amount, ✔ Deadline in the future, ✔ Deposit address present (a "–" means the check doesn't apply to a preview). Then a **Pay 400.00 with SIMULATED testnet USDC** button. |
| D5 | Click **Pay 400.00 with SIMULATED testnet USDC** (no wallet prompt) | "SIMULATED payment <id>: mock USDC was sent to ramatest1.pay.runway-rama.testnet…" and the status list with **SUCCESS: Delivered to the merchant's settlement account** in bold. |
| D6 | Wait about 30 seconds, then reload `/merchant` and `/lend` | **Routed revenue**: this window's bar shows about 400. `/lend` Wallet: **400 USDC more**. With no loan, all of the payment is yours. |
| D7 | Repeat D4–D5 **once** in each of the next **two** windows, with the same 400 | Three bars of 400 in **Routed revenue**, and the wallet 1,200 USDC up in total. |
| D8 | Negative: refund address `hello` | Hint "Not a valid base address" and **Get quote** stays disabled. |
| D9 | Negative: open the **Pay with** list | Every asset "on bsc" is disabled with "— minimum $1,000" for a 400 USDC invoice. |

## Part E: Offer, loan and repayment, in USDC (15 minutes)

| ID | Do | Expected |
|---|---|---|
| E1 | (Optional, before the third window has ended) `/merchant/capital` → **Sign and request an offer** | Card **Declined** with the reason "needs 3 buckets of revenue history". |
| E2 | In the window right after the third one: `/merchant/capital` | **Underwriter** card with a green **session key matches chain** badge: "Agent uwagent.runway-rama.testnet is registered with role Underwriter; your request is encrypted…". |
| E3 | **Sign and request an offer** → the wallet asks you to **sign a message** (no fee) | After 10–40 seconds: card **Offer #<id>** with a green **commitment verified** badge. Grade **C**, Limit **100.00**, Fee **10.00%**, Repay share **9.17%**. Reasons: "payer data unavailable: diversity scored as 0", "score 42.50 → grade C", "limit bounded by tier cap". (The first offer is capped at 100 USDC; the score 42.50 comes from three equal windows.) |
| E4 | (Optional) Before E3, attach a statement CSV under **Statements** (sample below) | Same offer, perhaps with a higher score (up to about 47.50); the grade stays C and the limit 100.00. The statement is read by NEAR AI private inference. Up to 20 statements a day, after which: "NEAR AI daily call cap reached". |
| E5 | `/audit/offer/<your id>` | The same checks as A5, all ✔ except the expected "Contract requires a TEE". |
| E6 | Negative: Amount to draw `150` → **Accept** | The transaction fails with `ERR_BOUNDS_LIMIT` (allowed: 50 to 100). |
| E7 | Amount to draw `100` (prefilled as 100.000000) → **Accept** → approve (1 yoctoNEAR) | Under the button: ✔ PendingTerms ✔ PendingTransfer ✔ **Active**. `/lend` Wallet: **100 USDC more**. Vault: Outstanding principal 100.00 and Utilization about 1%. |
| E8 | Reload `/merchant` | **Loan** card: Status **Active**, Principal **100.00**, Owed **110.00**, Repay share **9.17%** "of each payment", "Repaid 0.00 of 110.00 (0%)". `/audit` lists the loan. |
| E9 | **Within 5 minutes of E7**, pay `1200` with the pay link (D4–D5 with amount 1200) | After about 30 seconds and a reload: the loan is fully repaid (110.00) and the Loan card shows "No active loan". **Credit record**: Loans repaid **1**, Defaults 0, Borrowed **100.00**, Repaid **110.00**. Wallet: **1,090 USDC more** (1,200 − 110). Vault: Outstanding principal back to 0.00. |
| E10 | (Instead of E9) a partial repayment: pay `400` | "Repaid 36.68 of 110.00 (33.3%)". Keep paying at least 120 USDC every 5 minutes, or pay 800 more to finish. |

**Sample statement CSV** for E4 (save as `statement.csv`):

```csv
date,description,credit_usd
2026-09-03,Customer payments,410.00
2026-09-17,Customer payments,395.00
2026-10-02,Customer payments,400.00
2026-10-21,Customer payments,405.00
2026-11-04,Customer payments,398.00
```

## Part F: Merchant sale in rupees (UPI) (10 minutes)

| ID | Do | Expected |
|---|---|---|
| F1 | Pay link → **UPI (₹)** tab | Card "Pay ramatest1 in rupees (UPI)" with the SIMULATED banner and an **Amount (₹)** field. |
| F2 | Amount `8500` | Hint below the field: "₹8,500.00". |
| F3 | **Get UPI QR** | "Estimated rate ₹100.xx per USDC → about 84.xx USDC. The rate is fixed when the payment is confirmed." An **Open the SIMULATED UPI page** button, "Expires in 14:5x" counting down, and "Status: pending". (The rate follows live INR markets plus a 0.5% spread.) |
| F4 | **Open the SIMULATED UPI page** (opens a new tab) | A red badge "SIMULATED UPI — no real money", the collect id, **₹8,500.00**, the expiry time, and two buttons: **Simulate success** and **Simulate failure**. |
| F5 | **Simulate success** | The tab reloads and shows "Already paid.". |
| F6 | Back on the pay page, wait about 10–20 seconds | Status goes **pending → paid → delivered** (green), then "Recorded on-chain as receipt 0x… **NEAR transaction**". The link opens the INR gateway contract on NearBlocks. |
| F7 | Wait about 30 seconds and reload `/merchant` and `/lend` | **Routed revenue**: this window up by about 84.xx. Wallet: about 84.xx USDC more (USDC payout mode, no loan). With an active loan, 9.17% of it repays the loan instead. |
| F8 | `/audit` → INR rail → `ramatest1` → **Show** | A receipt row: ₹8,500.00, the rate (₹100.xx), USDC (84.xx), a payer hash, status **Delivered**. |
| F9 | Negative: a new **Get UPI QR** → SIMULATED page → **Simulate failure** | The pay page status becomes **failed** (red). Nothing reaches the merchant, and no receipt appears in `/audit`. |
| F10 | Negative: amount `200000` (₹2,00,000) → **Get UPI QR** | Error "amount above the per-payment cap" (one UPI payment is at most ₹1,00,000). No QR appears. |
| F11 | Negative: get a QR and do nothing for 15 minutes | The countdown reaches "Expires in 0:00" and the status stays pending. **Simulate success** on the SIMULATED page then answers "collect expired". Nothing moves. |

## Part G: Merchant payouts in rupees (10 minutes)

| ID | Do | Expected |
|---|---|---|
| G1 | `/merchant/settings` | **Payout currency**: "Current: Usdc". **Rupee payout account** form. **₹ payout history**: "No rupee payouts yet." |
| G2 | **Rupee payout account** → UPI → Name `Rama Test` → UPI ID `ramatest@okaxis` → **Register** → the wallet asks you to **sign a message** | "Registered: `r***@okaxis`" (a masked label). Only an encrypted blob is stored on-chain. |
| G3 | Negative: UPI ID `ramatest` (no `@bank`) | **Register** stays disabled. |
| G4 | **Switch to ₹ (INR)** → approve | "Current: Inr" and "Your share of each payment is paid out in rupees by the INR gateway." `/merchant` now shows the badge **payouts in ₹**. |
| G5 | Make a sale: pay `400` with the Crypto tab (D4–D5), or ₹ with the UPI tab (F2–F6) | About 30–60 seconds later, a reload of `/merchant/settings` shows a **₹ payout history** row: kind `merchant_share`, USDC (about 400), ₹ (about 400 × the payout rate, for example ₹40,0xx), status **Paid** (it may briefly show Pending or Processing). Your wallet gets **no** USDC for this sale. |
| G6 | `/audit` → INR rail → your handle | **Rupee payouts**: the same payout with its ₹ amount, rate, a **UTR hash** and status **Paid**. |
| G7 | (Optional) While in ₹ mode, get and accept a new offer (only possible after the first loan is repaid, and only in a later window) | The loan goes Active, and the 100 USDC arrives as a rupee payout of kind `loan_disbursement` (Paid) instead of USDC in your wallet. |
| G8 | **Switch to USDC** → approve | "Current: Usdc". The next sale goes to your wallet in USDC again. |

## Part H: Lender, in rupees (10 minutes)

H3 needs the UPI ID registered in G2 (same wallet).

| ID | Do | Expected |
|---|---|---|
| H1 | `/lend` → **Deposit ₹ (UPI)** → Amount `5000` → **Get UPI QR** | Estimated rate and "about 49.xx USDC", an **Open the SIMULATED UPI page** button, and the expiry countdown. |
| H2 | SIMULATED page → **Simulate success** → back on `/lend` | Status **delivered**. The card header's runUSDC goes up by about 49.7 (₹5,000 ÷ rate ÷ share price). |
| H3 | **Withdraw to ₹ (UPI or bank)** → Shares `20` → **Request ₹ withdrawal** → approve | "Request #<id> is in its 120s cooldown; it is priced when you claim." and a **Claim** button. |
| H4 | Wait 2 minutes → **Claim** → approve | "Payout #<id>: **Paid** 20.0x USDC → ₹2,0xx.xx" (it may show Pending or Processing first). `/merchant/settings` history has a `lender_withdrawal` row with status Paid. |
| H5 | Negative: in a wallet that never registered a UPI ID, open **Withdraw to ₹** | The alert "Register a UPI ID or bank account first…" and **Request ₹ withdrawal** stays disabled. |

## Part I: The exit page, without the web app (5 minutes)

| ID | Do | Expected |
|---|---|---|
| I1 | Open the exit page link → **Connect wallet** (Meteor, testnet) | "Signed in as <your account> (sign out)". |
| I2 | Handle `ramatest1` → **View** | JSON with your merchant record: handle, settlement account, payout account and mode, and loan if any. |
| I3 | **settle()** → approve | The transaction succeeds. If USDC arrived since the last settle it is split as usual; otherwise nothing moves. |
| I4 | **claim_payout()** with nothing claimable | Fails with `ERR_NOTHING_TO_CLAIM`. This is expected; it works when "Claimable" on `/merchant` is above 0. |
| I5 | Loan id from E7 → **View**, then **check_loan()** | The loan JSON (status Repaid after E9). check_loan succeeds. |
| I6 | A withdrawal request id → **View**, then **claim_withdraw()** or **cancel_withdraw()** | The same results as C5 and C6, without using the Runway site. |

## Part J: Failure paths (optional, use a second wallet, 25 minutes)

Use a **new wallet and handle**: a default is permanent for that merchant.

| ID | Do | Expected |
|---|---|---|
| J1 | New wallet, **skip B2**. Register a merchant and pay it 400 | The keeper can't deliver the share, so `/merchant` shows **Claimable: 400.00** USDC (payouts that couldn't be delivered). |
| J2 | `/lend` → **Get 1,000 test USDC** (this registers the wallet), then `/merchant` → **Claim payout** → approve | Claimable goes back to 0.00 and the wallet gets the 400 USDC. |
| J3 | Build three windows (D4–D7), get an offer and **Accept**, then **make no payments** | After the first 5-minute loan period has ended (and a keeper check, within about 30 seconds): Status **Delinquent**. `/lend` Provisions above 0. |
| J4 | Keep not paying for one more period | Status **Defaulted**. **Credit record**: Defaults **1**. |
| J5 | Request a new offer | **Declined** with "merchant has a default on record". |

## Part K: Deployment and automation (5 minutes)

| ID | Do | Expected |
|---|---|---|
| K1 | GitHub → Actions → **Testnet** → Run workflow → task `verify` | Green. The log ends with `DEPLOYMENT OK` and has no ✖ lines. |
| K2 | GitHub → Actions → **Testnet** → Run workflow → task `e2e` (about 30 minutes; spends about 3 NEAR from the root account) | Green, with `TESTNET E2E PASSED`. |
| K3 | Merge any pull request into `main` | CI, Sandbox and Backend go green. "Deploy web (Vercel)" shows **skipped** (by design). Render redeploys after the checks (about a minute of downtime), and Vercel builds `runway` and marks it Ready. |

---

## Results sheet

Copy this table and fill it in. For anything that fails, note the time (IST), the account and handle, a
screenshot, and any red text on the page or in the browser console (F12 → Console).

| ID | Result (Pass / Fail) | Notes (ids, amounts, errors) |
|---|---|---|
| A1–A8 | | |
| B1–B3 | | |
| C1–C6 | | |
| D1–D9 | | |
| E1–E10 | | |
| F1–F11 | | |
| G1–G8 | | |
| H1–H5 | | |
| I1–I6 | | |
| J1–J5 | | |
| K1–K3 | | |

## Quick reference

| Rule (testnet) | Value |
|---|---|
| Revenue window | 5 minutes, aligned to the clock |
| History needed for an offer | 3 windows in a row with revenue, median at least 300 USDC per window; ask in the next window |
| First offer (no identity anchor) | at most 100 USDC; grade C: fee 10%, repay share = owed ÷ (3 × median window) |
| Draw limits | 50 USDC to the offer's limit |
| Offer valid for | 1 hour |
| Loan period | 5 minutes; at least 10% of what is owed each period; Delinquent after 1 missed, Defaulted after 2 |
| Withdrawal cooldown | 120 seconds; priced when claimed |
| Merchant registration | about 2 NEAR deposit (storage of the keyless settlement account) |
| Share storage | 0.01 NEAR |
| Test USDC | 1,000 per click, once per 10 minutes per account |
| UPI payment | at most ₹1,00,000 each, ₹10,00,000 a day across the gateway; a collect expires after 15 minutes |
| INR rate | live CoinDCX and WazirX USDC/INR median, 0.5% spread, refused outside ₹70–₹130 |
| Rupee payout | at most 2,000 USDC each |
| Keeper | settles payments and checks loans every 15 seconds while the backend is awake |
