"use client";
// /audit (BUILD_PLAN T5.5, T4b.9): look up an offer, list active loans, and a merchant's INR
// receipts (paise, rate, USDC, payer hash) and payouts (₹, rate, UTR hash).
import { formatInr } from "@runway/fx";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Container, ErrorText, Field, PageHeader } from "../../components/ui";
import { payoutsFor } from "../../lib/actions";
import { credit, gateway } from "../../lib/chain";
import { bps, fmtUsdc, short } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

export default function AuditPage() {
  const [offerId, setOfferId] = useState("");
  const [handle, setHandle] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const loans = useAsync(() => credit.activeLoans(), []);
  const inr = useAsync(async () => {
    if (!query) return null;
    const m = await credit.merchant(query);
    const receipts = await gateway.payinsByHandle(query);
    const payouts = m ? await payoutsFor(m.merchant.payout) : [];
    return { receipts, payouts };
  }, [query]);

  return (
    <Container className="py-10">
      <PageHeader eyebrow="Audit" title="Check any offer, loan or rupee receipt">
        Everything here is public on-chain. Look up an offer to see its terms re-checked against the
        contract&apos;s rules, see every active loan and how much is repaid, and list a merchant&apos;s rupee
        receipts and payouts.
      </PageHeader>
      <div className="space-y-6">
        <Card
          title="Offer"
          description="Enter an offer number (the Capital page shows it, e.g. 2) to audit it."
        >
          <div className="flex items-end gap-2">
            <Field
              label="Offer id"
              value={offerId}
              onChange={(e) => setOfferId(e.target.value.replace(/\D/g, ""))}
            />
            <Link
              className="mb-0.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong"
              href={offerId ? `/audit/offer/${offerId}` : "#"}
            >
              Open
            </Link>
          </div>
        </Card>
        <Card title="Active loans" description="Loans being repaid from merchants' sales right now.">
          {(loans.data ?? []).length === 0 ? (
            <p className="text-sm text-subtle">None.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-subtle">
                  <th>Loan</th>
                  <th>Merchant</th>
                  <th>Principal</th>
                  <th>Repaid / owed</th>
                  <th>Share</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.data!.map((l) => (
                  <tr key={l.id}>
                    <td className="font-mono">{l.id}</td>
                    <td>{l.handle}</td>
                    <td className="font-mono">{fmtUsdc(l.principal)}</td>
                    <td className="font-mono">
                      {fmtUsdc(l.repaid)} / {fmtUsdc(l.owed)}
                    </td>
                    <td>{bps(l.repay_bps)}</td>
                    <td>
                      <Badge
                        tone={l.status === "Active" ? "good" : l.status === "Delinquent" ? "warn" : "neutral"}
                      >
                        {l.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card
          title="INR rail for a merchant"
          description="Every UPI receipt the gateway recorded for a handle, and every rupee payout to that merchant. Try e2ed573wq."
        >
          <div className="mb-3 flex items-end gap-2">
            <Field label="Handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
            <Button onClick={() => setQuery(handle)} disabled={!handle}>
              Show
            </Button>
          </div>
          {inr.data && (
            <div className="space-y-4 text-sm">
              <table className="w-full" aria-label="INR receipts">
                <caption className="text-left font-medium">UPI receipts (gateway contract)</caption>
                <thead>
                  <tr className="text-left text-subtle">
                    <th>Receipt</th>
                    <th>₹</th>
                    <th>Rate</th>
                    <th>USDC</th>
                    <th>Payer hash</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inr.data.receipts.map(([h, r]) => (
                    <tr key={h}>
                      <td className="font-mono">{short(h)}</td>
                      <td className="font-mono">{formatInr(BigInt(r.inr_paise))}</td>
                      <td className="font-mono">₹{(r.rate_ppu / 100).toFixed(2)}</td>
                      <td className="font-mono">{fmtUsdc(r.delivered)}</td>
                      <td className="font-mono">{r.payer_ref_hash ? short(r.payer_ref_hash) : "—"}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full" aria-label="INR payouts">
                <caption className="text-left font-medium">Rupee payouts</caption>
                <thead>
                  <tr className="text-left text-subtle">
                    <th>#</th>
                    <th>USDC</th>
                    <th>₹</th>
                    <th>Rate</th>
                    <th>UTR hash</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inr.data.payouts.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono">{p.id}</td>
                      <td className="font-mono">{fmtUsdc(p.usdc)}</td>
                      <td className="font-mono">{p.inr_paise ? formatInr(BigInt(p.inr_paise)) : "—"}</td>
                      <td className="font-mono">{p.rate_ppu ? `₹${(p.rate_ppu / 100).toFixed(2)}` : "—"}</td>
                      <td className="font-mono">{p.utr_hash ? short(p.utr_hash) : "—"}</td>
                      <td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <ErrorText error={loans.error ?? inr.error} />
      </div>
    </Container>
  );
}
