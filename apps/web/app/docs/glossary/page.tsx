import { Lead, Prose } from "../../../components/Prose";

export const metadata = { title: "Glossary & FAQ · Runway docs" };

const TERMS: [string, string][] = [
  [
    "1Click (NEAR Intents)",
    "A swap service that takes a token on almost any chain and delivers USDC on NEAR. Customers' crypto payments go through it.",
  ],
  [
    "Anchor (identity anchor)",
    "Proof that a merchant controls an outside business account (Stripe or Razorpay). Anchored merchants get higher caps (500 → 15,000 USDC).",
  ],
  [
    "Attestation",
    "Cryptographic proof that code runs inside a secure enclave (TEE). On testnet the agents use mock attestation (local mode).",
  ],
  [
    "Bucket / window",
    "A slice of time in which a merchant's revenue is added up: 5 minutes on testnet, 30 days on mainnet, aligned to the clock.",
  ],
  [
    "Claimable",
    "A merchant's payout that couldn't be delivered (usually because the wallet wasn't registered with USDC). It waits safely; press Claim payout.",
  ],
  [
    "Commitment",
    "A hash of the inputs an offer was based on, stored on-chain. The Capital page re-computes it to check the offer wasn't changed.",
  ],
  [
    "Default",
    "A loan that missed two periods in a row. Its unpaid principal is written off; the reserve covers it first.",
  ],
  [
    "Delinquent",
    "A loan that missed one period's minimum. Half its unpaid principal is set aside (provisioned) until it catches up.",
  ],
  [
    "Exit page",
    "A static web page on IPFS that can settle, claim and withdraw with just a wallet, without any Runway server.",
  ],
  [
    "Fee",
    "A flat percentage of the loan added once at the start: 4% (A), 7% (B) or 10% (C). Not an annual rate.",
  ],
  [
    "Float",
    "The INR gateway's USDC, on-chain. It pays out when someone pays in rupees and refills when someone is paid in rupees.",
  ],
  [
    "Grade",
    "A, B or C, from the underwriter's score (A ≥ 75, B ≥ 55, C ≥ 40). It sets the fee and how much of the median window can be lent.",
  ],
  [
    "INR gateway",
    "The agent and contract that convert rupees to USDC and back, at the live rate minus 0.5%.",
  ],
  [
    "INR treasury",
    "Runway's rupee balance at its payment provider (off-chain). The other half of the gateway's exchange counter.",
  ],
  [
    "Keeper",
    "A background service that calls settle() and check_loan() every 15 seconds. Anyone can make the same calls (for example, from the exit page).",
  ],
  [
    "Limit",
    "The most a merchant can borrow under an offer: the smallest of a share of the median window, the tier cap, 15,000 and what's repayable in about 3 windows.",
  ],
  [
    "Local mode",
    "How agents run on testnet: whitelisted accounts with mock attestation instead of a hardware TEE.",
  ],
  [
    "Median window (R)",
    "The middle value of the merchant's recent completed windows. The base for the limit and the repay share.",
  ],
  ["NAV (vault value)", "Cash + loans outstanding − provisions. Owned by lenders through shares."],
  [
    "NEP-413",
    "A NEAR standard for signing a message with your wallet. It proves who you are without sending a transaction or paying anything.",
  ],
  [
    "Offer",
    "A proposed loan: limit, fee, repay share and grade, valid for 1 hour, recorded on-chain by the underwriter and checked by the contract.",
  ],
  ["Period (loan period)", "5 minutes on testnet. Each must repay at least 10% of what is owed."],
  [
    "Provision",
    "Money set aside in the vault's books for a late loan. It lowers the share price until the loan catches up.",
  ],
  [
    "Repay share",
    "The fixed percentage of every payment that goes to the loan while it is open (5–25%). Set so about 3 median windows repay it.",
  ],
  [
    "Reserve (first-loss)",
    "Protocol money that pays defaults before lenders do. It receives 10% of every fee.",
  ],
  ["runUSDC", "The vault's share token. Its price in USDC rises as fees are repaid."],
  [
    "Session key",
    "A short-lived encryption key an agent publishes on-chain. Your browser checks it before encrypting anything to the agent.",
  ],
  [
    "Settlement account",
    "handle.pay.runway-rama.testnet: the keyless account each merchant is paid into. It splits each payment and forwards it.",
  ],
  ["Spread", "The 0.5% the INR gateway keeps on each conversion."],
  ["TEE", "Trusted execution environment: a secure enclave whose code can be proven by attestation."],
  [
    "Underwriter",
    "The agent that reads a merchant's revenue privately and proposes an offer. Its code is the scoring you can try in the Simulator.",
  ],
  ["Utilization", "Loans outstanding ÷ vault value. Capped at 80% so withdrawals can be paid."],
  [
    "UTR",
    "Unique transaction reference of an Indian bank transfer. Payouts store a hash of it on-chain as proof.",
  ],
];

const FAQ: [string, string][] = [
  ["Is this real money?", "No. NEAR testnet, mock USDC, simulated UPI. Contract calls are real and public."],
  [
    "How long until I can borrow?",
    "On testnet: three 5-minute windows of revenue, then ask in the next window. About 20 minutes.",
  ],
  [
    "Why was my offer declined?",
    "The Capital page shows the reason. Most often: fewer than 3 windows, a median below 300 USDC, or uneven windows (score below 40). The Simulator shows why.",
  ],
  [
    "Can I repay early?",
    "Yes. Any payment to your settlement account repays the loan's share of it; a large one can repay it all at once. Extra comes back to you.",
  ],
  [
    "What if I have a slow week?",
    "You repay less, because it's a share of sales. But each loan period needs at least 10% of what's owed, or the loan becomes delinquent.",
  ],
  [
    "Can lenders lose money?",
    "Only if a default is bigger than the reserve. Late loans lower the share price temporarily through provisions.",
  ],
  [
    "Why wait 120 seconds to withdraw?",
    "So nobody can leave at the old price just before a loss is booked. Your request is priced when you claim.",
  ],
  [
    "Do I need crypto to use UPI?",
    "No. A merchant in ₹ payout mode receives rupees; a customer pays by UPI. Only the protocol uses USDC in between.",
  ],
  [
    "Why does my wallet need test USDC first?",
    "A NEAR wallet must be registered with a token to receive it. The faucet button registers it as well as sending USDC.",
  ],
  [
    "Who can see my UPI ID?",
    "Only the INR gateway enclave (and the payment provider, to pay you). On-chain there is only ciphertext; the site shows a masked label.",
  ],
];

const ERRORS: [string, string][] = [
  ["ERR_COOLDOWN", "The withdrawal wait isn't over. Wait, then claim."],
  ["ERR_HANDLE_TAKEN", "Pick another handle."],
  ["ERR_BOUNDS_LIMIT", "Draw between 50 USDC and the offer's limit."],
  ["ERR_OFFER_EXPIRED", "Offers last 1 hour. Request a new one."],
  ["ERR_ACTIVE_LOAN", "Repay your current loan first."],
  ["ERR_DEFAULTED", "A defaulted merchant can't borrow again."],
  ["ERR_LIQUIDITY / ERR_UTILIZATION", "Not enough free cash in the vault right now."],
  ["ERR_DAILY_CAP", "Today's 2,000 USDC for first-time borrowers is used up."],
  ["ERR_NOTHING_TO_CLAIM", "Nothing is waiting to be claimed."],
  ["amount above the per-payment cap", "One UPI payment is at most ₹1,00,000."],
  [
    "this account got test USDC in the last 10 minutes",
    "The faucet gives 1,000 every 10 minutes per account.",
  ],
  ["Failed to fetch", "The free backend was asleep; wait a minute and retry."],
];

export default function GlossaryDoc() {
  return (
    <Prose>
      <h1>Glossary & FAQ</h1>
      <Lead>Every term used on the site, the common questions, and what each error message means.</Lead>
      <h2>Glossary</h2>
      <dl className="not-prose my-5 grid gap-3 sm:grid-cols-2">
        {TERMS.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-panel p-4">
            <dt className="font-semibold text-ink-900">{t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-subtle">{d}</dd>
          </div>
        ))}
      </dl>
      <h2>Questions</h2>
      {FAQ.map(([q, a]) => (
        <details key={q} className="my-2 rounded-xl border border-line bg-panel px-4 py-3">
          <summary className="flex items-center justify-between font-semibold text-ink-900">
            {q} <span className="details-chevron text-sand-600 transition-transform">›</span>
          </summary>
          <p className="!mb-1 text-sm text-subtle">{a}</p>
        </details>
      ))}
      <h2>Error messages</h2>
      <table>
        <thead>
          <tr>
            <th>Message contains</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          {ERRORS.map(([e, d]) => (
            <tr key={e}>
              <td>
                <code>{e}</code>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Prose>
  );
}
