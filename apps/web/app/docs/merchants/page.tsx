import Link from "next/link";
import { Formula, Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "For merchants · Runway docs" };

export default function MerchantsDoc() {
  return (
    <Prose>
      <h1>For merchants</h1>
      <Lead>
        You get a payment link that accepts crypto and UPI, a revenue record that builds itself, and a loan
        that repays itself from your sales. Here is every step, what to enter, and what you&apos;ll see.
      </Lead>

      <h2>Before you start</h2>
      <ul>
        <li>
          <strong>A NEAR testnet wallet</strong> (Meteor Wallet works best). Switch it to testnet and get at
          least <strong>4 NEAR</strong> from <a href="https://near-faucet.io">near-faucet.io</a>. Registration
          locks about 2 NEAR.
        </li>
        <li>
          <strong>Test USDC first.</strong> On <Link href="/lend">Lenders</Link>, press “Get 1,000 test USDC”.
          This registers your wallet with the USDC token so your sales and your loan can be paid to it.
        </li>
      </ul>

      <h2>1. Register a handle</h2>
      <p>
        On <Link href="/merchant">Merchants</Link>, type a handle: 2–32 lowercase letters or digits, like{" "}
        <code>ramastore</code>. As you type, the page shows the account it will create:{" "}
        <code>ramastore.pay.runway-rama.testnet</code>. Press <strong>Register</strong> and approve in your
        wallet.
      </p>
      <ul>
        <li>
          <strong>What it costs:</strong> about 2.00125 NEAR, which pays for the settlement account&apos;s
          storage on NEAR.
        </li>
        <li>
          <strong>What it creates:</strong> a <em>settlement account</em> with no access keys. Nobody can sign
          for it. It can only split payments and forward them, by the contract&apos;s rules.
        </li>
        <li>
          <strong>Your payout account</strong> is the wallet you registered with. Your share of every payment
          goes there (or to your bank in rupees, if you choose).
        </li>
      </ul>

      <h2>2. Get paid</h2>
      <p>
        Your dashboard has a <strong>payment link</strong> and a QR code. Set an amount and share it.
        Customers can pay:
      </p>
      <ul>
        <li>
          <strong>Crypto</strong>: any supported token on any chain. NEAR Intents (1Click) swaps it and
          delivers USDC on NEAR to your settlement account. On testnet you see a live mainnet price, then
          press “Pay with SIMULATED testnet USDC”.
        </li>
        <li>
          <strong>UPI (₹)</strong>: the INR gateway converts rupees to USDC at the live rate. On testnet you
          press “Simulate success” instead of paying in a UPI app.
        </li>
      </ul>
      <p>
        Within about 15 seconds the keeper calls <code>settle()</code>: the money is split (all of it is yours
        if there&apos;s no loan) and the amount is added to your current revenue window.
      </p>

      <h2>3. Build your revenue history</h2>
      <p>
        Revenue is counted in <strong>windows</strong>: 5 minutes of clock time on testnet (:00–:05, :05–:10,
        …), 30 days on mainnet. The underwriter looks at your <strong>completed</strong> windows, up to the
        last 6, starting with your first sale. An empty window in between counts as 0.
      </p>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Why it matters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>At least 3 windows with revenue</td>
            <td>Otherwise: “needs 3 buckets of revenue history”.</td>
          </tr>
          <tr>
            <td>Median window at least 300 USDC</td>
            <td>Otherwise: “median routed revenue too low”.</td>
          </tr>
          <tr>
            <td>Steady amounts score higher</td>
            <td>Uneven windows, or an empty one, can push the score below 40 (declined).</td>
          </tr>
        </tbody>
      </table>
      <Callout tone="tip" title="The reliable recipe on testnet">
        Pay yourself <strong>400 USDC once</strong> in each of <strong>three windows in a row</strong>, early
        in each window (say at 10:01, 10:06 and 10:11). Then ask for the offer{" "}
        <strong>in the next window</strong> (between 10:15 and 10:20). Your dashboard shows the window clock
        and counts the windows for you.
      </Callout>

      <h2>4. Ask for an offer</h2>
      <p>
        On <Link href="/merchant/capital">Capital</Link>, press <strong>Sign and request an offer</strong>.
        Your wallet asks you to <em>sign a message</em> (free, no transaction). Your browser first checks the
        underwriter&apos;s session key on-chain, then encrypts the request so only that agent can read it.
      </p>
      <ul>
        <li>
          <strong>Optional evidence:</strong> a Stripe test key or up to 3 statement files (CSV or PDF).
          Statements are read by NEAR AI private inference and can add up to 10 points to your score.
        </li>
        <li>
          <strong>What comes back:</strong> a grade (A, B or C), a limit, a fee, a repay share, and the
          reasons. The page checks the offer&apos;s commitment against the chain (“commitment verified”).
        </li>
      </ul>
      <p>For three 400 USDC windows the numbers are:</p>
      <Formula result="400 USDC">median window R = median(400, 400, 400)</Formula>
      <Formula result="100 USDC">limit = min(R × 0.3 for grade C, first-loan cap 100, …)</Formula>
      <Formula result="10 USDC → you owe 110">fee = 100 × 10%</Formula>
      <Formula result="9.17%">repay share = owed ÷ (3 × R) = 110 ÷ 1,200</Formula>
      <p>
        The repay share is sized so about three windows of your usual sales repay the loan. See exactly how
        the score works in the <Link href="/simulator#offer">offer simulator</Link>.
      </p>

      <h3>Why an offer can be declined</h3>
      <table>
        <thead>
          <tr>
            <th>Reason shown</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>needs 3 buckets of revenue history</td>
            <td>Keep selling; ask after the third window has ended.</td>
          </tr>
          <tr>
            <td>median routed revenue too low</td>
            <td>Typical windows need 300 USDC or more.</td>
          </tr>
          <tr>
            <td>score … below 40</td>
            <td>Revenue looks unsteady. Make one equal payment per window and ask in the next window.</td>
          </tr>
          <tr>
            <td>revenue too concentrated in one payer</td>
            <td>
              Over 60% from one payer. Simulated UPI payments all come from one payer, so build history with
              crypto.
            </td>
          </tr>
          <tr>
            <td>merchant has a default on record</td>
            <td>A defaulted merchant gets no new offers.</td>
          </tr>
        </tbody>
      </table>

      <h2>5. Accept the loan</h2>
      <p>
        Choose how much to draw: from 50 USDC up to the limit. Drawing less lowers the repay share in
        proportion (never below 5%), and the fee is the same percentage of what you draw. Press{" "}
        <strong>Accept</strong> and approve (1 yoctoNEAR). The loan moves through three states in a few
        seconds:
      </p>
      <ol>
        <li>
          <strong>PendingTerms</strong>: the loan&apos;s repay share is written to your settlement account.
        </li>
        <li>
          <strong>PendingTransfer</strong>: the USDC is sent from the vault to you.
        </li>
        <li>
          <strong>Active</strong>: it arrived. If the transfer couldn&apos;t be delivered, the loan becomes{" "}
          <strong>Failed</strong>, the cash returns to the vault, and you owe nothing.
        </li>
      </ol>
      <p>An offer stays valid for 1 hour.</p>

      <h2>6. Repay (automatically)</h2>
      <p>
        From now on, every payment to your settlement account is split: the repay share goes to the vault, the
        rest to you. The loan never takes more than you still owe; any extra in the last payment comes back to
        you in the same transaction.
      </p>
      <Formula result="36.68 to the loan, 363.32 to you">a 400 USDC sale at 9.17%</Formula>
      <Callout tone="warn" title="Each loan period has a minimum">
        Loan periods are 5 minutes on testnet. Each must repay at least <strong>10% of what you owe</strong>{" "}
        (11 USDC on a 110 loan): one sale of about 120 USDC per period does it. Miss one period and the loan
        is <strong>Delinquent</strong>; miss two in a row and it is <strong>Defaulted</strong>, which blocks
        future loans. The easiest test: pay yourself 1,200 right after the loan starts. It repays 110 at once
        and you keep 1,090.
      </Callout>

      <h2>7. Get paid in rupees (optional)</h2>
      <p>
        On <Link href="/merchant/settings">Settings</Link>:
      </p>
      <ol>
        <li>
          Register a <strong>UPI ID</strong> (like <code>name@okaxis</code>) or a bank account. Your wallet
          signs a message; the details are encrypted in your browser to the INR gateway, and only a masked
          label like <code>n***@okaxis</code> comes back.
        </li>
        <li>
          Press <strong>Switch to ₹ (INR)</strong>. From then on your share of each payment (and a new loan)
          is paid in rupees by the gateway: <code>₹ = USDC × rate × 99.5%</code>.
        </li>
      </ol>
      <p>
        Register the UPI ID first: a rupee payout to an unregistered account fails and refunds you in USDC.
      </p>

      <h2>Troubleshooting</h2>
      <table>
        <thead>
          <tr>
            <th>You see</th>
            <th>Why, and what to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>“Claimable: 400.00 USDC”</td>
            <td>
              Your wallet wasn&apos;t registered with USDC when you were paid. Get test USDC once, then press
              Claim payout.
            </td>
          </tr>
          <tr>
            <td>Revenue chart didn&apos;t move</td>
            <td>
              The keeper settles within about 15 seconds; reload after 30. If the backend slept, the first
              request wakes it (up to a minute).
            </td>
          </tr>
          <tr>
            <td>Loan Failed</td>
            <td>The USDC couldn&apos;t reach your wallet. Get test USDC once, then request a new offer.</td>
          </tr>
          <tr>
            <td>ERR_HANDLE_TAKEN</td>
            <td>Someone has that handle. Pick another.</td>
          </tr>
          <tr>
            <td>ERR_BOUNDS_LIMIT</td>
            <td>Draw between 50 USDC and the offer&apos;s limit.</td>
          </tr>
        </tbody>
      </table>
    </Prose>
  );
}
