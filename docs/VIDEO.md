# Demo video (T6.3)

Two minutes. The human records it; this is the script and the exact clicks. Under Amendment A1 there
is no mainnet leg: every scene is testnet or the local sandbox, and the screen says which.

## Before recording

1. Deploy to testnet (runbook §8.2 and §8.5) and start the API, the underwriter and the INR gateway
   in local mode. Or record against the sandbox with `make sandbox-demo-inr` in a terminal.
2. Prepare Priya's testnet account with loan #1 repaid (run the sandbox-style history: 6 buckets of
   SIMULATED payments, one 500 USDC loan repaid).
3. Open these tabs: `/merchant` (Priya), `/merchant/capital`, `/pay/priya?amount=1000`,
   `/audit/offer/<id>`, `/verify`, `exit.html`.
4. Browser zoom 110%, dark mode off, notifications off.

## Script

| Time | Screen | Say |
|---|---|---|
| 0:00 | `/merchant` (Priya) | "Priya runs a design studio. Clients pay her in stablecoins on several chains. Banks ignore that income, and DeFi lending wants 150% collateral." |
| 0:10 | `/pay/priya?amount=1000` → Crypto → USDC on Base → Get quote | "Customers pay from any chain through NEAR Intents. The browser checks the 1Click quote's signature, recipient and amount before anything is paid. This is testnet, so the quote is a live price preview and the payment is simulated mock USDC." Click **Pay with SIMULATED testnet USDC**. |
| 0:30 | `/merchant/capital` | "Her credit record shows a first loan repaid. The underwriter's session key is checked against its on-chain registration, and her request is encrypted to it." Click **Sign and request an offer**, sign in the wallet. Offer: **$2,000, 7% fee, 17.84% of routed payments**. |
| 1:00 | Accept | "Accepting runs a state machine on-chain: terms set, transfer, active." Point at PendingTerms → PendingTransfer → Active. |
| 1:15 | `/pay/priya` → simulate $1,000 → `/merchant` loan card | "The next $1,000 payment splits in the settlement contract: $178.40 to lenders, $821.60 to Priya." |
| 1:25 | `/pay/priya` → UPI (₹) → ₹8,500 → Open the SIMULATED UPI page → Simulate success | "Rupee customers pay by UPI. On testnet this is a simulated provider. 100 USDC lands in her settlement account and splits; her share arrives in rupees with a UTR." Show `/merchant/settings` history: ₹6,983.60. |
| 1:35 | `/audit/offer/<id>` | "Anyone can re-check the offer: hard bounds, the agent's approved role, the commitment to the private inputs. Lenders never see her data." Click **Recompute commitment** → matches. |
| 1:45 | `/verify`, then `exit.html` | "The agents are attested accounts with owner-approved roles; revoking one stops its offers. And if every server disappears, this single static page still settles and withdraws." |

## Click checklist

- [ ] Wallet connected as Priya before 0:30 (the NEP-413 prompt appears on click).
- [ ] The offer at 0:30 must be grade B, 2,000 USDC: Priya needs 6 buckets of ~4,000 USDC and 1 repaid loan.
- [ ] After accepting, refresh `/merchant` once so the loan card shows Active.
- [ ] Keep the mock UPI tab open next to `/pay/priya`.
- [ ] Say "simulated" or "testnet" on every payment scene.
