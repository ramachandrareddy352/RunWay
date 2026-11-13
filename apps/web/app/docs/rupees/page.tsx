import Link from "next/link";
import { Formula, Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "Rupees & the INR gateway · Runway docs" };

export default function RupeesDoc() {
  return (
    <Prose>
      <h1>Rupees and the INR gateway</h1>
      <Lead>
        The vault, the loans and every split are in USDC. Rupees exist only at the edges, where the INR
        gateway converts them. There is no rupee balance on-chain, so who actually holds the rupees?
      </Lead>

      <h2>The gateway is an exchange counter with two drawers</h2>
      <table>
        <thead>
          <tr>
            <th>Drawer</th>
            <th>Where</th>
            <th>What happens to it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>USDC float</strong>
            </td>
            <td>
              On-chain, in <code>inr.runway-rama.testnet</code>. Anyone can see it.
            </td>
            <td>Goes down when someone pays in rupees; goes up when someone is paid out in rupees.</td>
          </tr>
          <tr>
            <td>
              <strong>INR treasury</strong>
            </td>
            <td>Off-chain: Runway&apos;s Razorpay / RazorpayX / bank balance.</td>
            <td>Goes up when someone pays in rupees; goes down when someone is paid out in rupees.</td>
          </tr>
        </tbody>
      </table>
      <p>
        So rupees in and rupees out balance each other over time. If one drawer runs low, Runway&apos;s
        operations team rebalances off-chain (for example, sells rupees for USDC on an Indian exchange and
        adds it to the float with <code>FundFloat</code>). On testnet the float was seeded with 5,000 mock
        USDC and the mock provider moves no real rupees; every on-chain step is still real.
      </p>

      <h2>Who converts, step by step</h2>
      <ol>
        <li>
          The customer pays ₹ by UPI to a QR the gateway created. The rupees land in Runway&apos;s provider
          account.
        </li>
        <li>
          The provider notifies the <strong>gateway agent</strong> (it runs in a secure enclave). The agent
          checks the webhook&apos;s signature and fetches the payment again from the provider&apos;s API.
        </li>
        <li>
          It calls <code>record_payin</code> with the live rate. The contract checks: the agent&apos;s role,
          the rate band (₹70–₹130), the per-payment cap (₹1,00,000), the daily cap (₹10,00,000), the float,
          and that this payment was never recorded before.
        </li>
        <li>The contract sends USDC from the float to the target and stores a receipt on-chain.</li>
      </ol>

      <h2>The exact formulas</h2>
      <p>
        Rates are in paise per 1 USDC (₹100.00 = 10000). USDC is counted in millionths. Results are rounded
        down.
      </p>
      <Formula result="99.500000 USDC">
        ₹10,000 in: USDC = 1,000,000 paise × 1,000,000 × 9,950 ÷ (10,000 × 10,000)
      </Formula>
      <Formula result="₹9,900.25">
        99.50 USDC out: paise = 99,500,000 × 10,000 × 9,950 ÷ (1,000,000 × 10,000)
      </Formula>
      <p>
        The gateway keeps a <strong>0.5% spread</strong> on each conversion; that is its income and covers FX
        risk. A full rupee round trip (₹ in, ₹ out) costs about 1%. Try your own amounts at the live rate in
        the <Link href="/simulator#inr">rupee converter</Link>.
      </p>

      <h2>The six rupee flows</h2>
      <table>
        <thead>
          <tr>
            <th>Flow</th>
            <th>Path</th>
            <th>Float</th>
            <th>Treasury</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>UPI sale</td>
            <td>customer ₹ → USDC to the merchant&apos;s settlement account → split as usual</td>
            <td>−</td>
            <td>+</td>
          </tr>
          <tr>
            <td>Merchant paid in ₹</td>
            <td>merchant&apos;s share → gateway → ₹ to their UPI ID</td>
            <td>+</td>
            <td>−</td>
          </tr>
          <tr>
            <td>Loan in ₹</td>
            <td>vault → gateway → ₹ to the merchant (for merchants in ₹ mode)</td>
            <td>+</td>
            <td>−</td>
          </tr>
          <tr>
            <td>Lender deposits ₹</td>
            <td>investor ₹ → USDC into the vault for them → shares minted</td>
            <td>−</td>
            <td>+</td>
          </tr>
          <tr>
            <td>Lender withdraws to ₹</td>
            <td>shares&apos; USDC value → gateway → ₹ to their UPI ID</td>
            <td>+</td>
            <td>−</td>
          </tr>
          <tr>
            <td>Repay in ₹</td>
            <td>merchant ₹ → USDC straight to their loan</td>
            <td>−</td>
            <td>+</td>
          </tr>
        </tbody>
      </table>

      <h3>Example: a merchant who sells in ₹ and is paid in ₹</h3>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Float</th>
            <th>Treasury</th>
            <th>Merchant&apos;s bank</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Start</td>
            <td>5,000.00</td>
            <td>₹5,00,000</td>
            <td>₹0</td>
          </tr>
          <tr>
            <td>Customer pays ₹10,000 by UPI → 99.50 USDC to the settlement account</td>
            <td>4,900.50</td>
            <td>₹5,10,000</td>
            <td>₹0</td>
          </tr>
          <tr>
            <td>Settled, no loan: 99.50 USDC → gateway → payout</td>
            <td>5,000.00</td>
            <td>₹5,00,099.75</td>
            <td>₹9,900.25</td>
          </tr>
        </tbody>
      </table>
      <p>
        The float is back where it started, the merchant received ₹9,900.25 for a ₹10,000 sale, and the
        gateway kept ₹99.75 (two spreads).
      </p>

      <h2>What is recorded on-chain</h2>
      <ul>
        <li>
          <strong>Every pay-in receipt</strong>: ₹ amount, rate, USDC delivered, a hash of the payer (no UPI
          ID), status.
        </li>
        <li>
          <strong>Every payout</strong>: USDC, ₹ amount, rate, a hash of the bank reference (UTR), status.
        </li>
        <li>
          <strong>Payout details</strong>: only as ciphertext that the gateway enclave can decrypt. The site
          shows you a masked label like <code>n***@okaxis</code>.
        </li>
      </ul>
      <p>
        See them for any merchant under “INR rail” on the <Link href="/audit">Audit</Link> page.
      </p>

      <h2>When something goes wrong</h2>
      <ul>
        <li>
          <strong>The float is too low for a payment:</strong> new UPI QRs are refused. Crypto keeps working.
        </li>
        <li>
          <strong>A payout can&apos;t be sent</strong> (wrong or missing UPI ID): it fails and the USDC is
          refunded to the person&apos;s NEAR account. If even that fails, it becomes a refund they can claim
          from the gateway.
        </li>
        <li>
          <strong>The price feeds disagree:</strong> the oracle needs at least two exchange prices close
          together, so pay-ins and payouts pause instead of using a bad rate.
        </li>
      </ul>
      <Callout tone="info">
        On testnet the provider is a mock labelled <strong>SIMULATED UPI</strong>: you press “Simulate
        success” instead of paying. A real deployment uses Razorpay UPI QR codes and RazorpayX payouts.
      </Callout>
    </Prose>
  );
}
