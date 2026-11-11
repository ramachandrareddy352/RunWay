import Link from "next/link";
import { Card, SimulatedBanner } from "../components/ui";

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Runway</h1>
        <p className="mt-2 text-subtle">
          Credit lines for merchants paid in stablecoins or UPI. Payments route through a keyless settlement
          account, a private underwriter prices the loan from that revenue, and repayment is a share of each
          payment, taken on-chain.
        </p>
      </div>
      <SimulatedBanner>
        This deployment runs on NEAR testnet with mock USDC and a simulated UPI provider.
      </SimulatedBanner>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Merchants">
          <p className="text-sm">
            Register a handle, share a payment link, see routed revenue, and ask for an offer.
          </p>
          <Link className="mt-3 inline-block text-sm text-accent underline" href="/merchant">
            Open the merchant dashboard
          </Link>
        </Card>
        <Card title="Lenders">
          <p className="text-sm">
            Deposit USDC (or rupees) into the vault, earn the loan fees, withdraw after a cooldown.
          </p>
          <Link className="mt-3 inline-block text-sm text-accent underline" href="/lend">
            Open the vault
          </Link>
        </Card>
        <Card title="Audit">
          <p className="text-sm">Every offer's bounds, commitment and agent, re-checked in your browser.</p>
          <Link className="mt-3 inline-block text-sm text-accent underline" href="/audit">
            Audit offers
          </Link>
        </Card>
        <Card title="Verify the agents">
          <p className="text-sm">
            Which agent images are approved, which accounts run them, and whether their session keys match the
            chain.
          </p>
          <Link className="mt-3 inline-block text-sm text-accent underline" href="/verify">
            Verify
          </Link>
        </Card>
      </div>
    </div>
  );
}
