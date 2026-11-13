import { Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "For customers · Runway docs" };

export default function CustomersDoc() {
  return (
    <Prose>
      <h1>For customers (paying a merchant)</h1>
      <Lead>
        You opened a merchant&apos;s Runway payment link. You can pay with crypto from almost any chain, or
        with UPI in rupees. Here&apos;s what each screen means.
      </Lead>

      <h2>The top of the page</h2>
      <p>
        “Pay <em>handle</em>” and “Settles to <code>handle.pay.runway-rama.testnet</code>”. That is the
        merchant&apos;s keyless settlement account. Your browser reads it from{" "}
        <strong>two independent NEAR RPCs</strong> and they must agree, so a tampered server can&apos;t swap
        in another account.
      </p>

      <h2>Paying with crypto</h2>
      <ol>
        <li>
          <strong>Pay with</strong>: pick a token and chain, for example “USDC on base”. Some chains have a
          minimum (BNB Chain $1,000, Tron $100); those options are greyed out for smaller amounts.
        </li>
        <li>
          <strong>Refund address</strong>: an address of yours <em>on the chain you pay from</em>. If the swap
          can&apos;t complete, the funds go back there. The page checks its format.
        </li>
        <li>
          <strong>Get quote</strong>: a live NEAR Intents (1Click) quote. Your browser checks it before
          showing anything to pay:
        </li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>What it protects</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Quote signed by 1Click</td>
            <td>The quote really came from 1Click and wasn&apos;t edited.</td>
          </tr>
          <tr>
            <td>Pays the merchant&apos;s settlement account</td>
            <td>The money goes to the right place.</td>
          </tr>
          <tr>
            <td>Delivers USDC on NEAR</td>
            <td>The merchant receives the right asset.</td>
          </tr>
          <tr>
            <td>Delivers at least the invoice amount</td>
            <td>The merchant isn&apos;t short-changed by slippage.</td>
          </tr>
          <tr>
            <td>Deadline in the future · deposit address present</td>
            <td>The quote is still valid and complete.</td>
          </tr>
        </tbody>
      </table>
      <p>
        On mainnet the deposit address and QR code appear only if every check passes. On testnet 1Click
        can&apos;t pay a testnet account, so the quote is a <strong>price preview</strong> and you press{" "}
        <strong>Pay with SIMULATED testnet USDC</strong> instead.
      </p>
      <h3>Payment statuses</h3>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PENDING_DEPOSIT</td>
            <td>Waiting for your deposit.</td>
          </tr>
          <tr>
            <td>KNOWN_DEPOSIT_TX</td>
            <td>Your deposit was seen on the origin chain.</td>
          </tr>
          <tr>
            <td>PROCESSING</td>
            <td>Being swapped to USDC on NEAR.</td>
          </tr>
          <tr>
            <td>SUCCESS</td>
            <td>Delivered to the merchant&apos;s settlement account.</td>
          </tr>
          <tr>
            <td>INCOMPLETE_DEPOSIT · REFUNDED · FAILED</td>
            <td>
              You sent less than quoted, or the swap failed: you&apos;re refunded to your refund address.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Paying with UPI (rupees)</h2>
      <ol>
        <li>
          Open the <strong>UPI (₹)</strong> tab and enter the amount in rupees (for example <code>8500</code>
          ). The page previews about how much USDC the merchant receives at the live rate.
        </li>
        <li>
          Press <strong>Get UPI QR</strong>. In real use you scan the QR with any UPI app. On testnet you get
          an <strong>Open the SIMULATED UPI page</strong> button instead.
        </li>
        <li>
          On the simulated page press <strong>Simulate success</strong> (or “Simulate failure” to test that
          path).
        </li>
        <li>
          Back on the payment page the status moves <code>pending → paid → delivered</code>, and you get the
          on-chain receipt.
        </li>
      </ol>
      <Callout tone="info">
        The QR expires after 15 minutes. One UPI payment can be at most ₹1,00,000. The rate is fixed when the
        payment is confirmed, so the final USDC can differ slightly from the estimate.
      </Callout>

      <h2>What happens to your payment</h2>
      <p>
        It lands in the merchant&apos;s settlement account, and within seconds it is split: if the merchant
        has a loan, a fixed share repays it to the lenders&apos; vault; the rest goes to the merchant. You
        don&apos;t need to do anything else, and you pay the same price either way.
      </p>
    </Prose>
  );
}
