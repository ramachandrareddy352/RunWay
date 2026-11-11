"use client";
// /merchant (BUILD_PLAN T5.2): register, payment link + QR, routed revenue, loan card, record,
// claim_payout, update_payout.
import { completeBuckets } from "@runway/sdk";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { RevenueChart, type BucketPoint } from "../../components/RevenueChart";
import { Badge, Button, Card, ErrorText, Field, Stat } from "../../components/ui";
import { claimPayout, registerMerchant, updatePayout } from "../../lib/actions";
import { credit, settlements } from "../../lib/chain";
import { PROFILE } from "../../lib/env";
import { bps, fmtUsdc } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useWallet } from "../../lib/wallet";

export default function MerchantPage() {
  const w = useWallet();
  const [handle, setHandle] = useState("");
  const [newPayout, setNewPayout] = useState("");
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<unknown>(null);
  const m = useAsync(
    () => (w.accountId ? credit.merchantByAccount(w.accountId) : Promise.resolve(null)),
    [w.accountId],
  );
  const merchant = m.data;
  const chain = useAsync(async () => {
    if (!merchant) return null;
    const [state, buckets, loan] = await Promise.all([
      settlements.state(merchant.merchant.settlement),
      settlements.buckets(merchant.merchant.settlement),
      merchant.merchant.active_loan ? credit.loan(merchant.merchant.active_loan) : Promise.resolve(null),
    ]);
    return { state, buckets, loan };
  }, [merchant?.merchant.settlement, merchant?.merchant.active_loan]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setTxError(null);
    try {
      await f();
      m.reload();
      chain.reload();
    } catch (e) {
      setTxError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!w.accountId)
    return (
      <Card title="Merchant">
        <p className="mb-3 text-sm">Connect the wallet that should receive your payouts.</p>
        <Button onClick={w.signIn}>Connect wallet</Button>
      </Card>
    );
  if (m.loading && merchant === undefined) return <p className="text-sm text-subtle">Loading…</p>;
  if (!merchant)
    return (
      <Card title="Register as a merchant">
        <div className="space-y-3">
          <p className="text-sm">
            Pick a handle. Runway creates <span className="font-mono">&lt;handle&gt;.pay.…</span>, a keyless
            settlement account that splits every payment between your loan (if any) and you. The deposit
            (about 2 NEAR) pays for that account&apos;s storage.
          </p>
          <Field
            label="Handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            hint="2–32 lowercase letters or digits"
          />
          <Button
            disabled={!/^[a-z0-9]{2,32}$/.test(handle) || busy}
            onClick={() => run(() => registerMerchant(w, handle))}
          >
            Register {handle || "…"}
          </Button>
          <ErrorText error={txError ?? m.error} />
        </div>
      </Card>
    );

  const h = merchant.merchant.handle;
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/pay/${h}?amount=${amount}` : `/pay/${h}`;
  const current = chain.data ? BigInt(chain.data.state.current_bucket) : 0n;
  const done = chain.data ? completeBuckets(chain.data.buckets, current) : [];
  const first = current - BigInt(done.length);
  const points: BucketPoint[] = [
    ...done.map((v, i) => ({ bucket: first + BigInt(i), inflow: v, current: false })),
    ...(chain.data
      ? [
          {
            bucket: current,
            inflow: BigInt(chain.data.buckets.find((b) => BigInt(b.bucket) === current)?.inflow ?? "0"),
            current: true,
          },
        ]
      : []),
  ];
  const loan = chain.data?.loan;
  const repaidPct = loan ? Number((BigInt(loan.repaid) * 1000n) / BigInt(loan.owed)) / 10 : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {h} <Badge>{merchant.merchant.payout_mode === "Inr" ? "payouts in ₹" : "payouts in USDC"}</Badge>{" "}
        {merchant.merchant.frozen && <Badge tone="bad">frozen</Badge>}
      </h1>
      <Card title="Payment link">
        <div className="flex flex-wrap items-start gap-4">
          <QRCodeSVG value={link} size={120} />
          <div className="min-w-0 flex-1 space-y-2">
            <Field label="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="break-all font-mono text-xs">{link}</p>
          </div>
        </div>
      </Card>
      <Card title="Routed revenue">
        <RevenueChart points={points} source={PROFILE.revenueSource} />
      </Card>
      <Card title="Loan">
        {loan ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Status" value={loan.status} />
              <Stat label="Principal" value={fmtUsdc(loan.principal)} />
              <Stat label="Owed" value={fmtUsdc(loan.owed)} />
              <Stat label="Repay share" value={bps(loan.repay_bps)} sub="of each payment" />
            </div>
            <div aria-label="repayment progress" className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-2 rounded bg-accent" style={{ width: `${repaidPct}%` }} />
            </div>
            <p className="text-sm">
              Repaid {fmtUsdc(loan.repaid)} of {fmtUsdc(loan.owed)} ({repaidPct}%).
            </p>
          </div>
        ) : (
          <p className="text-sm">
            No active loan.{" "}
            <a className="text-accent underline" href="/merchant/capital">
              Ask for an offer
            </a>
            .
          </p>
        )}
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Credit record">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Loans repaid" value={merchant.record.loans_repaid} />
            <Stat label="Defaults" value={merchant.record.loans_defaulted} />
            <Stat label="Borrowed" value={fmtUsdc(merchant.record.total_borrowed)} />
            <Stat label="Repaid" value={fmtUsdc(merchant.record.total_repaid)} />
          </div>
        </Card>
        <Card title="Payout">
          <div className="space-y-3">
            <p className="text-sm">
              Claimable: <span className="font-mono">{fmtUsdc(merchant.claimable)}</span> USDC (payouts that
              couldn&apos;t be delivered).
            </p>
            <Button
              disabled={BigInt(merchant.claimable) === 0n || busy}
              onClick={() => run(() => claimPayout(w))}
            >
              Claim payout
            </Button>
            <Field
              label="New payout account"
              value={newPayout}
              onChange={(e) => setNewPayout(e.target.value)}
              hint={`Now: ${merchant.merchant.payout}`}
            />
            <Button
              variant="secondary"
              disabled={!newPayout || busy}
              onClick={() => run(() => updatePayout(w, newPayout.trim()))}
            >
              Update payout account
            </Button>
          </div>
        </Card>
      </div>
      <ErrorText error={txError ?? chain.error} />
    </div>
  );
}
