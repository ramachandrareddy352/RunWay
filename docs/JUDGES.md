# Testing Runway as a judge

Runway runs on **NEAR testnet**. Every payment is SIMULATED: mock USDC, and a mock UPI provider where you
press "Simulate success" instead of paying. Nothing here moves real money.

**Web app:** https://runway-dusky.vercel.app · **Exit page (IPFS):**
https://ipfs.filebase.io/ipfs/bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4

Any IPFS gateway serves the exit page; that one serves it directly. `ipfs.io/ipfs/<CID>` also works in a
browser (it loads through a service worker), and Pinata's free public gateway refuses HTML pages.

The backend sleeps when idle (free hosting). If a page says the agent is unavailable, wait a minute and
reload. [docs/TESTING.md](TESTING.md) is the full test plan, with the expected result of every step.

## 1. A wallet (2 minutes)

Install Meteor Wallet (or use MyNearWallet), switch it to **testnet**, create an account, and get free
testnet NEAR from https://near-faucet.io. Registering as a merchant locks about 2 NEAR, so get at least 4.

Then, **before anything else**, open `/lend`, connect, and press **Get 1,000 test USDC**. Besides the USDC,
this registers your wallet with the mock USDC token; without that your share of payments and your loan
can't be delivered to you.

## 2. Look around without signing anything

- `/verify`: the credit and INR gateway contracts, the approved agent images and roles, and both agents'
  session keys checked against the chain.
- `/audit/offer/2`: a real testnet offer. The contract's bounds are re-checked in your browser, along with
  the agent's role, the settlement account's code hash and its zero access keys.
- `/lend`: vault value, share price, utilization, provisions and reserve.

## 3. Be a merchant (about 20 minutes, mostly waiting)

1. `/merchant` → Connect wallet → register a handle. Runway creates `<handle>.pay.runway-rama.testnet`,
   a settlement account with **no keys**.
2. Open your payment link (`/pay/<handle>?amount=400`). On the Crypto tab pick "USDC on base", enter a
   refund address (any EVM address, for example `0x52908400098527886e0f7030069857d2e4169ee7`) and press
   **Get quote**: this is a real NEAR Intents 1Click quote (a mainnet price preview), verified in your
   browser. Then **Pay 400.00 with SIMULATED testnet USDC**.
3. Repeat step 2 **once** in each of the next two 5-minute windows (windows follow the clock: :00–:05,
   :05–:10, …), with the same amount. The revenue chart on `/merchant` fills in. Pay early in each window.
4. In the window right after the third one, `/merchant/capital` → **Sign and request an offer**. Your browser checks the underwriter's session key
   on-chain, you sign a NEP-413 message, and the request is encrypted to the agent. Optionally attach a
   CSV statement: it is read with NEAR AI private inference, verified by attestation. A first offer is
   capped at 100 USDC (no identity anchor): expect grade C, limit 100.00, fee 10.00%, repay share 9.17%.
5. **Accept**: the loan goes PendingTerms → PendingTransfer → Active and 100 USDC arrives in your wallet.
6. **Within 5 minutes**, pay yourself 1,200 on the pay page: the payment is split on-chain, 9.17% (110
   USDC) repays the loan and the rest reaches you. Testnet loan periods are 5 minutes; a loan that repays
   less than 10% in a period becomes delinquent, and after two such periods it defaults.
7. UPI: on the pay page's **UPI (₹)** tab enter ₹8500 → **Get UPI QR** → **Open the SIMULATED UPI page** →
   **Simulate success**. The rupees are converted at a live INR rate and arrive as USDC in your
   settlement account; the pay page shows pending → paid → delivered and the on-chain receipt.
8. `/merchant/settings`: switch payouts to ₹ and register a UPI ID (only a masked label is stored, encrypted).
   Your next UPI sale is paid out in rupees (simulated), with the UTR hash on-chain.

## 4. Be a lender

1. `/lend` → **Get 1,000 test USDC** (if you haven't) → register share storage → deposit.
2. Request a withdrawal; after the 120-second cooldown, **Claim** (priced at claim time).
3. Or deposit and withdraw in rupees with the ₹ cards (simulated UPI).

## 5. The exit page

Open the IPFS link above, enter your handle and press `settle()` or `claim_payout()`: it works with only
your wallet and a public RPC, no Runway server.

## What is real and what is simulated

| Real (on NEAR testnet) | Simulated |
|---|---|
| Every contract call: settlement splits, loans, vault shares, the INR gateway's receipts and payouts | USDC (a mock token) and UPI (a mock provider) |
| 1Click quotes and their signature check (mainnet price previews) | The payment after the quote (1Click has no testnet) |
| NEAR AI private inference and its attestation (when a statement is uploaded) | TEE isolation: the agents run in Shade local mode (`requires_tee = false`) |
