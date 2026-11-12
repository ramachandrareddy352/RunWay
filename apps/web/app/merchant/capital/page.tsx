"use client";
// /merchant/capital (BUILD_PLAN T5.3): session check, NEP-413, optional Stripe key and statements,
// sealed request, offer card, accept (1 yocto) with live state-machine progress.
import { toBase64 } from "@runway/sdk";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorText, Field, Stat } from "../../../components/ui";
import { acceptOffer, requestOffer, type OfferResult } from "../../../lib/actions";
import { verifiedSession, type VerifiedSession } from "../../../lib/agents";
import { credit, verified } from "../../../lib/chain";
import { UNDERWRITER_URL } from "../../../lib/env";
import { bps, fmtUsdc, parseUsdc } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { useWallet } from "../../../lib/wallet";

const STATES = ["PendingTerms", "PendingTransfer", "Active"];

async function fileToStatement(f: File) {
  const mime = f.type === "application/pdf" || f.name.endsWith(".pdf") ? "application/pdf" : "text/csv";
  return {
    name: f.name,
    mime: mime as "text/csv" | "application/pdf",
    data_b64: toBase64(new Uint8Array(await f.arrayBuffer())),
  };
}

export default function CapitalPage() {
  const w = useWallet();
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [stripeKey, setStripeKey] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [offer, setOffer] = useState<OfferResult | null>(null);
  const [amount, setAmount] = useState("");
  const [loanStatus, setLoanStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const m = useAsync(
    () => (w.accountId ? credit.merchantByAccount(w.accountId) : Promise.resolve(null)),
    [w.accountId],
  );

  useEffect(() => {
    verifiedSession(UNDERWRITER_URL, "Underwriter", verified.credit.agent)
      .then(setSession)
      .catch(setSessionError);
  }, []);

  async function ask() {
    if (!m.data) return;
    setBusy(true);
    setError(null);
    setOffer(null);
    try {
      const statements = await Promise.all(files.slice(0, 3).map(fileToStatement));
      const r = await requestOffer(w, m.data.merchant.handle, {
        stripe_key: stripeKey.trim() || undefined,
        statements: statements.length ? statements : undefined,
      });
      setOffer(r);
      if (r.terms) setAmount(fmtUsdc(r.terms.limit, 6).replace(/,/g, ""));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setStripeKey("");
    }
  }

  async function accept() {
    const a = parseUsdc(amount);
    if (!offer?.offer_id || !a) return;
    setBusy(true);
    setError(null);
    try {
      await acceptOffer(w, offer.offer_id, a);
      // Loan ids follow the offer id (one shared counter); poll the state machine.
      for (let i = 0; i < 20; i++) {
        const mm = await credit.merchantByAccount(w.accountId!);
        const id = mm?.merchant.active_loan;
        const loan = id ? await credit.loan(id) : null;
        setLoanStatus(loan?.status ?? "Failed");
        if (!loan || loan.status === "Active" || loan.status === "Failed") break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!w.accountId)
    return (
      <Card title="Capital">
        <Button onClick={w.signIn}>Connect wallet</Button>
      </Card>
    );
  if (m.data === null) return <Card title="Capital">Register as a merchant first.</Card>;

  return (
    <div className="space-y-4">
      <Card
        title="Underwriter"
        aside={
          session ? (
            <Badge tone="good">session key matches chain</Badge>
          ) : (
            <Badge tone="warn">checking…</Badge>
          )
        }
      >
        {session ? (
          <p className="text-sm">
            Agent <span className="font-mono">{session.served.agent_account}</span> is registered with role{" "}
            {session.agent.role}; your request is encrypted to its on-chain session key and only that agent
            can read it.
          </p>
        ) : (
          <ErrorText error={sessionError} />
        )}
      </Card>
      <Card title="Evidence (optional)">
        <div className="space-y-3">
          <Field
            label="Stripe restricted key (read-only)"
            type="password"
            value={stripeKey}
            onChange={(e) => setStripeKey(e.target.value)}
            hint="rk_test_… on testnet (test mode, not real KYC). Used once inside the agent, never stored."
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Statements (CSV or PDF, up to 3)</span>
            <input
              type="file"
              multiple
              accept=".csv,.pdf,text/csv,application/pdf"
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
            />
            <span className="mt-1 block text-xs text-subtle">
              Read by NEAR AI private inference, verified by attestation. Affects corroboration only.
            </span>
          </label>
          <Button onClick={ask} disabled={!session || busy || !m.data}>
            {busy ? "Working…" : "Sign and request an offer"}
          </Button>
        </div>
      </Card>
      {offer && (
        <Card
          title={offer.decision === "offer" ? `Offer #${offer.offer_id}` : "Declined"}
          aside={
            offer.commitmentOk !== undefined && (
              <Badge tone={offer.commitmentOk ? "good" : "bad"}>
                {offer.commitmentOk ? "commitment verified" : "commitment mismatch"}
              </Badge>
            )
          }
        >
          {offer.terms && (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Grade" value={offer.terms.grade} />
              <Stat label="Limit" value={fmtUsdc(offer.terms.limit)} />
              <Stat label="Fee" value={bps(offer.terms.fee_bps)} />
              <Stat label="Repay share" value={bps(offer.terms.repay_bps)} />
            </div>
          )}
          <ul className="mb-3 list-disc pl-5 text-sm">
            {offer.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {offer.decision === "offer" && (
            <div className="space-y-2">
              <Field
                label="Amount to draw (USDC)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button onClick={accept} disabled={busy || !parseUsdc(amount)}>
                Accept
              </Button>
              {loanStatus && (
                <ol className="flex gap-3 text-sm" aria-label="loan state">
                  {STATES.map((s) => (
                    <li key={s} className={s === loanStatus ? "font-semibold" : "text-subtle"}>
                      {STATES.indexOf(s) <= STATES.indexOf(loanStatus) ? "✔" : "○"} {s}
                    </li>
                  ))}
                  {loanStatus === "Failed" && <li className="text-bad">Failed (liquidity released)</li>}
                </ol>
              )}
            </div>
          )}
        </Card>
      )}
      <ErrorText error={error} />
    </div>
  );
}
