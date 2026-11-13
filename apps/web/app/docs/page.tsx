import Link from "next/link";
import { Icon } from "../../components/art";
import { Lead, Prose } from "../../components/Prose";
import { Callout, Steps } from "../../components/ui";

export const metadata = { title: "Docs · Runway" };

export default function DocsHome() {
  return (
    <Prose>
      <h1>How Runway works</h1>
      <Lead>
        Runway gives merchants working capital based on the sales they receive through it, and lets anyone
        fund that capital and earn the fees. This page explains the whole idea in five minutes; the other
        pages go into each role.
      </Lead>

      <h2>The idea in one picture</h2>
      <ol>
        <li>
          A merchant registers a <strong>handle</strong> (like <code>priya</code>). Runway creates a{" "}
          <strong>settlement account</strong> for it, <code>priya.pay.runway-rama.testnet</code>, which has{" "}
          <strong>no keys</strong>: nobody can sign for it, not even Runway.
        </li>
        <li>
          Customers pay the merchant through a <strong>payment link</strong>: any crypto (swapped to USDC by
          NEAR Intents) or rupees by UPI (converted to USDC by the INR gateway). The money lands in the
          settlement account.
        </li>
        <li>
          A <strong>keeper</strong> calls <code>settle()</code> every few seconds. With no loan, 100% goes to
          the merchant. The amount is also counted in the merchant&apos;s <strong>revenue history</strong>.
        </li>
        <li>
          After a few windows of revenue, the merchant asks for an <strong>offer</strong>. A private{" "}
          <strong>underwriter</strong> agent scores the revenue and proposes a limit, a fee and a{" "}
          <strong>repay share</strong>. The contract checks it against fixed rules.
        </li>
        <li>
          The merchant accepts: USDC moves from the <strong>lenders&apos; vault</strong> to the merchant. From
          then on, the settlement account sends the repay share of every payment to the vault until the loan
          is repaid.
        </li>
        <li>
          <strong>Lenders</strong> deposit USDC (or rupees) into the vault and receive{" "}
          <strong>runUSDC shares</strong>. Loan fees raise the share price, which is how lenders earn.
        </li>
      </ol>

      <h2>Who uses it</h2>
      <div className="not-prose my-5 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["store", "Merchants", "Get paid, borrow, repay from sales.", "/docs/merchants"],
            ["vault", "Lenders", "Fund the vault, earn loan fees.", "/docs/lenders"],
            ["user", "Customers", "Pay a merchant in crypto or UPI.", "/docs/customers"],
            ["shield", "Judges & auditors", "Check every claim yourself.", "/docs/trust"],
          ] as const
        ).map(([ic, t, b, href]) => (
          <Link
            key={t}
            href={href}
            className="card-lift flex gap-3 rounded-xl border border-line bg-panel p-4 !no-underline"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-700 text-sand-300">
              <Icon name={ic} />
            </span>
            <span>
              <span className="block font-semibold text-ink-900">{t}</span>
              <span className="block text-sm font-normal text-subtle">{b}</span>
            </span>
          </Link>
        ))}
      </div>

      <h2>Quick start (testnet, about 30 minutes)</h2>
      <div className="not-prose my-5 rounded-2xl border border-line bg-panel p-5">
        <Steps
          items={[
            {
              title: "Wallet + NEAR",
              body: "Meteor Wallet on testnet, at least 4 NEAR from near-faucet.io.",
            },
            {
              title: "Test USDC first",
              body: "Lenders page → Get 1,000 test USDC. This also registers your wallet with the token.",
            },
            {
              title: "Register a merchant handle",
              body: "Merchants page. About 2 NEAR pays for your keyless settlement account.",
            },
            {
              title: "Three windows of revenue",
              body: "Pay yourself 400 test USDC once in each of three 5-minute windows in a row.",
            },
            {
              title: "Offer → accept",
              body: "In the next window: Capital → Sign and request an offer → Accept. Expect grade C, 100 USDC.",
            },
            {
              title: "Repay",
              body: "Within 5 minutes, pay yourself 1,200: 110 repays the loan, 1,090 is yours.",
            },
          ]}
        />
      </div>
      <Callout tone="tip" title="Why “test USDC first”?">
        A wallet must be registered with a token before it can receive it. The faucet button does that for
        you. A wallet that isn&apos;t registered can&apos;t receive its share of a payment (it waits as
        “claimable”) or a loan (the loan fails safely and nothing is lost).
      </Callout>

      <h2>Testnet vs mainnet</h2>
      <table>
        <thead>
          <tr>
            <th>What</th>
            <th>On testnet (this site)</th>
            <th>On mainnet (design)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Revenue window and loan period</td>
            <td>5 minutes</td>
            <td>30 days</td>
          </tr>
          <tr>
            <td>USDC</td>
            <td>a mock token, free from the faucet</td>
            <td>real USDC on NEAR</td>
          </tr>
          <tr>
            <td>UPI</td>
            <td>a mock provider: press “Simulate success”</td>
            <td>Razorpay UPI QR and RazorpayX payouts</td>
          </tr>
          <tr>
            <td>Crypto payments</td>
            <td>a live 1Click price preview, then a simulated transfer</td>
            <td>real 1Click swaps from any chain</td>
          </tr>
          <tr>
            <td>Agents</td>
            <td>local mode: whitelisted accounts, mock attestation</td>
            <td>TEEs with hardware attestation</td>
          </tr>
          <tr>
            <td>Withdrawal wait</td>
            <td>120 seconds</td>
            <td>7 days</td>
          </tr>
        </tbody>
      </table>

      <h2>Where to go next</h2>
      <ul>
        <li>
          Want to see the numbers? Open the <Link href="/simulator">Simulator</Link> or the{" "}
          <Link href="/docs/math">worked examples</Link>.
        </li>
        <li>
          Not sure about a word? The <Link href="/docs/glossary">glossary</Link> explains every term used on
          the site.
        </li>
        <li>
          Want to check it&apos;s honest? <Link href="/docs/trust">Trust, safety & checks</Link> shows how.
        </li>
      </ul>
    </Prose>
  );
}
