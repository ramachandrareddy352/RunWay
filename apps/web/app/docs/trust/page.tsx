import Link from "next/link";
import { Lead, Prose } from "../../../components/Prose";
import { Callout } from "../../../components/ui";

export const metadata = { title: "Trust, safety & checks · Runway docs" };

const EXIT_PAGE = "https://ipfs.filebase.io/ipfs/bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4";

export default function TrustDoc() {
  return (
    <Prose>
      <h1>Trust, safety and how to check it</h1>
      <Lead>
        Runway is built so you don&apos;t have to trust Runway. Here is what protects merchants, lenders and
        customers, and where you can check each claim yourself.
      </Lead>

      <h2>Settlement accounts have no keys</h2>
      <p>
        Every merchant&apos;s <code>handle.pay.runway-rama.testnet</code> is created with{" "}
        <strong>zero access keys</strong>. Nobody can sign a transaction for it. It runs one fixed program
        that can only split incoming USDC and forward it to the credit contract. On any offer&apos;s audit
        page your browser checks both: the account&apos;s code hash equals the factory&apos;s, and it has no
        keys.
      </p>

      <h2>Two RPCs must agree</h2>
      <p>
        Reads that decide where money goes (the pay page&apos;s settlement account, an agent&apos;s session
        key, the audit checks) are made against <strong>two independent NEAR RPC providers</strong> at the
        same block, and must match. A single lying server can&apos;t redirect a payment.
      </p>

      <h2>Verified agents</h2>
      <p>
        Two agents do the private work: the <strong>underwriter</strong> (scores revenue, signs offers) and
        the <strong>INR gateway</strong> (converts rupees). Each publishes a short-lived{" "}
        <strong>session key</strong> on-chain. Before your browser encrypts a loan request or a UPI ID, it
        checks that the key the agent serves matches the key on-chain. <Link href="/verify">Verify</Link>{" "}
        shows this for both agents, live.
      </p>
      <Callout tone="warn" title="Testnet: local mode">
        On testnet the agents run in <strong>local mode</strong>: whitelisted accounts with mock attestation,
        shown as “local mode” on Verify. The protocol, keys, encryption and checks are the same; hardware
        isolation (a TEE) is what a mainnet deployment adds, with a contract created with{" "}
        <code>requires_tee = true</code>.
      </Callout>

      <h2>Offers are bounded by the contract</h2>
      <p>
        The underwriter proposes; the credit contract decides. Every offer must fit the on-chain policy: limit
        between 50 USDC and the tier cap, fee between 3% and 15%, repay share between 5% and 25%, the current
        policy version, and an approved agent with the Underwriter role. A buggy or compromised agent
        can&apos;t issue an out-of-policy loan. Every offer also commits to its inputs, and the Capital page
        re-checks the commitment (“commitment verified”).
      </p>

      <h2>Requests are private</h2>
      <ul>
        <li>
          Loan requests are signed with your wallet (NEP-413, a signed message, not a transaction) and
          encrypted to the underwriter&apos;s session key.
        </li>
        <li>
          Statements are read by <strong>NEAR AI private inference</strong>; the response is checked against
          its attestation and only a receipt hash goes on-chain.
        </li>
        <li>UPI IDs and bank accounts are stored only as ciphertext; you see a masked label.</li>
      </ul>

      <h2>You can always leave</h2>
      <p>
        The <a href={EXIT_PAGE}>exit page</a> is a single static file pinned to IPFS. With only your wallet
        and a public RPC it can settle a settlement account, claim payouts and withdrawals, and check loans,
        even if every Runway server is gone.
      </p>

      <h2>Where to check things</h2>
      <table>
        <thead>
          <tr>
            <th>Question</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Are the agents the approved ones, with the right roles?</td>
            <td>
              <Link href="/verify">Verify</Link>
            </td>
          </tr>
          <tr>
            <td>Were this offer&apos;s terms within policy, from a valid agent?</td>
            <td>
              <Link href="/audit">Audit</Link> → Offer id
            </td>
          </tr>
          <tr>
            <td>Which loans are active, and how much is repaid?</td>
            <td>
              <Link href="/audit">Audit</Link> → Active loans
            </td>
          </tr>
          <tr>
            <td>Every rupee receipt and payout for a merchant</td>
            <td>
              <Link href="/audit">Audit</Link> → INR rail
            </td>
          </tr>
          <tr>
            <td>Any transaction</td>
            <td>
              <a href="https://testnet.nearblocks.io/address/credit.runway-rama.testnet">NearBlocks</a>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Real vs simulated on testnet</h2>
      <table>
        <thead>
          <tr>
            <th>Real</th>
            <th>Simulated</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Every contract call: splits, loans, shares, receipts, payouts</td>
            <td>USDC (a mock token) and UPI (a mock provider)</td>
          </tr>
          <tr>
            <td>1Click quotes and their signature check (mainnet price previews)</td>
            <td>The crypto payment after the quote</td>
          </tr>
          <tr>
            <td>NEAR AI private inference and its attestation</td>
            <td>TEE isolation (agents in local mode)</td>
          </tr>
          <tr>
            <td>The live INR rate from Indian exchanges</td>
            <td>The rupees themselves</td>
          </tr>
        </tbody>
      </table>
    </Prose>
  );
}
