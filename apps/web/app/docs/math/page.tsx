import Link from "next/link";
import { Formula, Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "Worked examples & formulas · Runway docs" };

export default function MathDoc() {
  return (
    <Prose>
      <h1>Worked examples and formulas</h1>
      <Lead>
        One merchant, one lender and one loan, followed through every payment with every balance, using the
        contracts&apos; exact integer maths. You can reproduce each number in the{" "}
        <Link href="/simulator">Simulator</Link>.
      </Lead>

      <h2>The setup</h2>
      <ul>
        <li>
          A lender deposits <strong>10,000 USDC</strong> into an empty vault. Runway seeds a{" "}
          <strong>100 USDC</strong> reserve.
        </li>
        <li>
          The INR gateway holds a <strong>5,000 USDC</strong> float; the INR treasury holds{" "}
          <strong>₹5,00,000</strong>.
        </li>
        <li>
          Rate <strong>₹100.00 per USDC</strong>, spread 0.5%. The merchant starts with nothing and is paid in
          USDC.
        </li>
      </ul>

      <h2>Step by step</h2>
      <h3>1. The lender deposits 10,000 USDC</h3>
      <Formula result="10,000 shares, price 1.000000">shares = 10,000 × (0 + 1) ÷ (0 + 1)</Formula>

      <h3>2. A 400 USDC crypto sale, no loan</h3>
      <p>
        The customer pays about 404 USDC on Base (the extra is swap fees, outside Runway). 1Click delivers
        exactly 400 USDC to the settlement account. <code>settle()</code>: no loan, so repay = 0 and all 400
        go to the merchant. The vault doesn&apos;t change: the money only passes through.
      </p>

      <h3>3. A ₹10,000 UPI sale, no loan</h3>
      <Formula result="99.50 USDC">USDC = ₹10,000 ÷ 100 × 99.5%</Formula>
      <p>
        The treasury gains ₹10,000 (worth 100 USDC), the float pays 99.50. The 0.50 difference is the
        gateway&apos;s spread. The merchant gets 99.50 USDC.
      </p>

      <h3>4. The offer (no money moves)</h3>
      <Formula result="grade C">three windows of 400 → score 42.50</Formula>
      <Formula result="100">
        limit = min(400 × 0.3 = 120, first-loan cap 100, 15,000, repayable 272.7)
      </Formula>
      <Formula result="9.17%">repay share = ceil(110 × 10,000 ÷ 1,200) bps = 917 bps</Formula>

      <h3>5. The merchant accepts 100 USDC</h3>
      <p>
        Cash 10,000 → 9,900, loans outstanding 0 → 100. The vault&apos;s value is still 10,000, so the share
        price doesn&apos;t move: lending turns cash into a loan of the same value.
      </p>

      <h3>6. A 400 USDC sale during the loan</h3>
      <Formula result="36.68 to the loan, 363.32 to the merchant">repay = floor(400 × 917 ÷ 10,000)</Formula>
      <Formula result="33.345454">principal part = floor(36.68 × 100 ÷ 110)</Formula>
      <Formula result="3.334546 (0.333454 to the reserve, 3.001092 to lenders)">
        fee part = 36.68 − 33.345454
      </Formula>

      <h3>7. A ₹10,000 UPI sale during the loan</h3>
      <p>
        The gateway delivers 99.50 USDC as in step 3, and it is split like any sale: 9.12415 repays the loan,
        90.37585 reaches the merchant.
      </p>

      <h3>8. A 1,200 USDC sale finishes the loan</h3>
      <p>
        Still owed: 110 − 45.80415 = 64.19585. The repay part would be 110.04, but only 64.19585 is needed, so
        the extra 45.84415 goes back to the merchant: 1,089.96 + 45.84415 = <strong>1,135.80415</strong>. The
        loan is <strong>Repaid</strong> and later sales go 100% to the merchant.
      </p>

      <h2>All the balances</h2>
      <table>
        <thead>
          <tr>
            <th>After</th>
            <th>Merchant</th>
            <th>Vault cash</th>
            <th>Loans out</th>
            <th>Vault value</th>
            <th>Share price</th>
            <th>Reserve</th>
            <th>Float</th>
            <th>Treasury</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["1 Deposit", "0", "10,000", "0", "10,000", "1.000000", "100", "5,000", "₹5,00,000"],
              ["2 Crypto 400", "400", "10,000", "0", "10,000", "1.000000", "100", "5,000", "₹5,00,000"],
              [
                "3 UPI ₹10,000",
                "499.50",
                "10,000",
                "0",
                "10,000",
                "1.000000",
                "100",
                "4,900.50",
                "₹5,10,000",
              ],
              ["5 Loan 100", "599.50", "9,900", "100", "10,000", "1.000000", "100", "4,900.50", "₹5,10,000"],
              [
                "6 Crypto 400",
                "962.82",
                "9,936.35",
                "66.65",
                "10,003.00",
                "1.000300",
                "100.33",
                "4,900.50",
                "₹5,10,000",
              ],
              [
                "7 UPI ₹10,000",
                "1,053.20",
                "9,945.39",
                "58.36",
                "10,003.75",
                "1.000375",
                "100.42",
                "4,801.00",
                "₹5,20,000",
              ],
              [
                "8 Crypto 1,200",
                "2,189.00",
                "10,009.00",
                "0",
                "10,009.00",
                "1.000899",
                "101.00",
                "4,801.00",
                "₹5,20,000",
              ],
            ] as const
          ).map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i} className={i ? "font-mono" : ""}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>Check the totals.</strong> The merchant&apos;s sales were 400 + 400 + 1,200 in crypto plus 2 ×
        99.50 from UPI = 2,199; add the 100 loan and subtract the 110 repaid = <strong>2,189</strong>. The 10
        USDC fee went 9.000002 to lenders and 0.999998 to the reserve. The live testnet vault shows almost
        exactly these numbers after its own test loan: cash 10,009.000002, share price 1.000899.
      </p>

      <h3>9. The lender withdraws 1,000 shares</h3>
      <Formula result="1,000.899910 USDC">1,000 × (10,009.000002 + 1) ÷ (10,000 + 1)</Formula>
      <p>
        In rupees instead: 1,000.899910 × 100 × 99.5% = <strong>₹99,589.54</strong> to the lender&apos;s UPI
        ID; the float goes up 1,000.90 and the treasury down ₹99,589.54. The share price is unchanged for
        everyone else.
      </p>

      <h2>When a merchant stops paying</h2>
      <p>Same vault, loan of 100 just disbursed, and no sales at all:</p>
      <table>
        <thead>
          <tr>
            <th>Moment</th>
            <th>Loan</th>
            <th>Provisions</th>
            <th>Vault cash</th>
            <th>Vault value</th>
            <th>Share price</th>
            <th>Reserve</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Disbursed</td>
            <td>Active</td>
            <td className="font-mono">0</td>
            <td className="font-mono">9,900</td>
            <td className="font-mono">10,000</td>
            <td className="font-mono">1.000000</td>
            <td className="font-mono">100</td>
          </tr>
          <tr>
            <td>Period 1 ends (repaid 0 of 11 needed)</td>
            <td>Delinquent</td>
            <td className="font-mono">50</td>
            <td className="font-mono">9,900</td>
            <td className="font-mono">9,950</td>
            <td className="font-mono">0.995000</td>
            <td className="font-mono">100</td>
          </tr>
          <tr>
            <td>Period 2 ends (missed again)</td>
            <td>Defaulted</td>
            <td className="font-mono">0</td>
            <td className="font-mono">10,000</td>
            <td className="font-mono">10,000</td>
            <td className="font-mono">1.000000</td>
            <td className="font-mono">0</td>
          </tr>
        </tbody>
      </table>
      <p>
        The reserve paid the whole 100, so lenders end whole. With only 30 in the reserve, the vault would end
        at 9,930 and every share would lose 0.7%. If the merchant pays during period 2 instead, the loan
        returns to Active and the provision is released.
      </p>

      <h2>All the formulas</h2>
      <table>
        <thead>
          <tr>
            <th>What</th>
            <th>Formula</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Vault value (NAV)</td>
            <td>cash + loans outstanding − provisions</td>
          </tr>
          <tr>
            <td>Share price</td>
            <td>(vault value + 1) ÷ (total shares + 1)</td>
          </tr>
          <tr>
            <td>Shares for a deposit</td>
            <td>deposit × (shares + 1) ÷ (value + 1)</td>
          </tr>
          <tr>
            <td>USDC for shares at claim</td>
            <td>shares × (value + 1) ÷ (shares + 1)</td>
          </tr>
          <tr>
            <td>Split of each payment</td>
            <td>repay = floor(payment × repay share); merchant = the rest; no loan → repay = 0</td>
          </tr>
          <tr>
            <td>Fee and amount owed</td>
            <td>fee = loan × fee %; owed = loan + fee</td>
          </tr>
          <tr>
            <td>Principal part of a repayment</td>
            <td>floor(total repaid × loan ÷ owed) − principal already repaid</td>
          </tr>
          <tr>
            <td>Fee part</td>
            <td>repayment − principal part; 10% to the reserve, 90% to the vault</td>
          </tr>
          <tr>
            <td>Minimum per loan period</td>
            <td>10% of owed (or what&apos;s left, if less)</td>
          </tr>
          <tr>
            <td>Provision while delinquent</td>
            <td>50% of the unpaid principal</td>
          </tr>
          <tr>
            <td>Default</td>
            <td>unpaid principal written off; reserve pays first</td>
          </tr>
          <tr>
            <td>Score</td>
            <td>
              35 × stability + 25 × history + 15 × diversity + 15 × trend + 10 × corroboration; C ≥ 40, B ≥
              55, A ≥ 75
            </td>
          </tr>
          <tr>
            <td>Limit</td>
            <td>
              min(median window × k, tier cap, 15,000, 3 × median × 25% ÷ (1 + fee)); k = 1.0 / 0.6 / 0.3 for
              A / B / C
            </td>
          </tr>
          <tr>
            <td>Repay share</td>
            <td>owed ÷ (3 × median window), between 5% and 25%</td>
          </tr>
          <tr>
            <td>₹ → USDC</td>
            <td>floor(paise × 1,000,000 × 9,950 ÷ (rate × 10,000))</td>
          </tr>
          <tr>
            <td>USDC → ₹</td>
            <td>floor(USDC × rate × 9,950 ÷ (1,000,000 × 10,000))</td>
          </tr>
        </tbody>
      </table>
      <Callout tone="tip">
        Everything is integer maths, rounded down, in millionths of a USDC and in paise. That is why some
        numbers end in …454 or …998: the browser previews on this site use the same integers, so they always
        match the chain.
      </Callout>
    </Prose>
  );
}
