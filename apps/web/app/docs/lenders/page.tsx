import Link from "next/link";
import { Formula, Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "For lenders · Runway docs" };

export default function LendersDoc() {
  return (
    <Prose>
      <h1>For lenders</h1>
      <Lead>
        Lenders put USDC (or rupees) into one shared vault. The vault funds merchants&apos; loans, and the
        loan fees make every lender&apos;s shares worth more. This page explains shares, returns, withdrawals
        and the risks.
      </Lead>

      <h2>The vault and your shares</h2>
      <p>
        When you deposit, you receive <strong>runUSDC shares</strong>: your slice of the vault. The
        vault&apos;s value (its NAV) and the share price are:
      </p>
      <Formula>vault value (NAV) = cash + loans outstanding − provisions</Formula>
      <Formula>share price = (vault value + 1) ÷ (total shares + 1)</Formula>
      <p>
        The <code>+1</code> is a virtual offset of 1 USDC that makes the price impossible to manipulate in an
        almost empty vault. The first-loss <strong>reserve</strong> is kept separately: it isn&apos;t
        lenders&apos; money and isn&apos;t part of the vault value.
      </p>

      <h2>Deposit</h2>
      <ol>
        <li>
          On <Link href="/lend">Lenders</Link>, press <strong>Get 1,000 test USDC</strong> (free, once every
          10 minutes).
        </li>
        <li>
          Press <strong>Register share storage</strong> once (0.01 NEAR): the vault needs a record for your
          shares.
        </li>
        <li>
          Enter an amount and press <strong>Deposit</strong>. The page shows how many shares you&apos;ll get
          before you confirm.
        </li>
      </ol>
      <Formula result="199.820179 shares">shares = 200 × (10,000 + 1) ÷ (10,009.000002 + 1)</Formula>
      <p>That was a real testnet deposit: at a share price of 1.000899, 200 USDC bought 199.82 shares.</p>
      <p>
        <strong>In rupees:</strong> use the “Deposit ₹ (UPI)” card. The INR gateway converts at the live rate
        minus 0.5% and deposits the USDC for you, so you get shares the same way.
      </p>

      <h2>Where the return comes from</h2>
      <p>
        Merchants repay their loan plus a flat fee (4%, 7% or 10% by grade). Each repayment is split into
        principal and fee in proportion. Of the fee part, <strong>90% goes to the vault</strong> (raising the
        share price) and <strong>10% to the reserve</strong>.
      </p>
      <Formula result="+9 USDC to lenders, +1 to the reserve">one 100 USDC loan at 10% (110 repaid)</Formula>
      <p>
        On a 10,000 USDC vault that one loan moved the share price from 1.000000 to 1.000899: exactly what the
        live testnet vault shows today. Lending itself doesn&apos;t change the share price: cash becomes a
        loan of the same value.
      </p>

      <h2>Withdraw</h2>
      <ol>
        <li>
          Enter a number of shares and press <strong>Request withdrawal</strong>. The shares move into escrow.
        </li>
        <li>
          Wait for the cooldown: <strong>120 seconds</strong> on testnet (7 days on mainnet).
        </li>
        <li>
          Press <strong>Claim</strong>. You receive the shares&apos; value <em>at claim time</em>.
        </li>
      </ol>
      <Formula result="1,000.899910 USDC">1,000 shares × (10,009.000002 + 1) ÷ (10,000 + 1)</Formula>
      <p>
        Pricing at claim time is deliberate: escrowed shares still share any loss booked during the wait, so
        nobody can exit at the old price just before a default. You can <strong>Cancel</strong> a request to
        get the shares back.
      </p>
      <p>
        <strong>In rupees:</strong> register a UPI ID in <Link href="/merchant/settings">Settings</Link>{" "}
        first, then use “Withdraw to ₹”. The USDC value goes to the INR gateway, which pays{" "}
        <code>₹ = USDC × rate × 99.5%</code> to your UPI ID and records the payout on-chain.
      </p>

      <h2>Risks, and how they&apos;re limited</h2>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Effect on your shares</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A loan is late one period (Delinquent)</td>
            <td>
              50% of its unpaid principal is set aside as a provision, so the share price dips. It recovers
              when the loan is current again.
            </td>
          </tr>
          <tr>
            <td>A loan defaults (two missed periods)</td>
            <td>
              The unpaid principal is written off. The reserve pays it first; lenders absorb only what the
              reserve can&apos;t cover.
            </td>
          </tr>
          <tr>
            <td>After a default, the merchant pays again</td>
            <td>Recoveries go to lenders&apos; uncovered loss first, then refill the reserve.</td>
          </tr>
          <tr>
            <td>Many withdrawals at once</td>
            <td>
              At most 80% of the vault can be lent out, so some cash is always free. If cash is still short, a
              claim fails with ERR_LIQUIDITY and can be retried once loans repay.
            </td>
          </tr>
        </tbody>
      </table>
      <Callout tone="info">
        Loans are also capped per merchant (100 USDC for a first loan without an identity anchor on testnet,
        rising with each repaid loan) and per day for new merchants (2,000 USDC in total). Try the{" "}
        <Link href="/simulator#lend">lender simulator</Link> to see a repaid, a late and a defaulted loan side
        by side.
      </Callout>

      <h2>The vault numbers on the Lenders page</h2>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Total assets (NAV)</td>
            <td>Cash plus loans outstanding, minus provisions.</td>
          </tr>
          <tr>
            <td>Share price</td>
            <td>What one runUSDC share is worth in USDC.</td>
          </tr>
          <tr>
            <td>Utilization</td>
            <td>Loans outstanding ÷ vault value. Capped at 80%.</td>
          </tr>
          <tr>
            <td>Outstanding principal</td>
            <td>USDC currently lent out and not yet repaid.</td>
          </tr>
          <tr>
            <td>Provisions</td>
            <td>Money set aside for late loans (50% of their unpaid principal).</td>
          </tr>
          <tr>
            <td>First-loss reserve</td>
            <td>The protocol&apos;s own money that pays defaults before lenders do.</td>
          </tr>
        </tbody>
      </table>
    </Prose>
  );
}
