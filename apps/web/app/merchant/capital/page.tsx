"use client";
// /merchant/capital (BUILD_PLAN T5.3): session check, NEP-413, optional Stripe key and statements,
// sealed request, offer card, accept (1 yocto) with live state-machine progress, and a live preview of
// the terms for the amount being drawn.
import { toBase64 } from "@runway/sdk";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  ErrorText,
  Explain,
  Field,
  PageHeader,
  Preview,
  Row,
  Stat,
  Steps,
} from "../../../components/ui";
import { acceptOffer, requestOffer, type OfferResult } from "../../../lib/actions";
import { verifiedSession, type VerifiedSession } from "../../../lib/agents";
import { credit, verified } from "../../../lib/chain";
import { PROFILE, UNDERWRITER_URL } from "../../../lib/env";
import { bps, fmtUsdc, parseUsdc } from "../../../lib/format";
import { drawTerms, periodRequirement } from "../../../lib/sim";
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

  const header = (
    <PageHeader eyebrow="Merchants · capital" title="Get an offer, then draw it">
      The underwriter reads your revenue privately and proposes a limit, a fee and a repay share. The contract
      checks the offer against fixed rules. You decide how much to draw.
    </PageHeader>
  );

  if (!w.accountId)
    return (
      <Container className="py-10">
        {header}
        <Card title="Capital">
          <p className="mb-4 text-sm text-subtle">Connect the wallet you registered as a merchant.</p>
          <Button onClick={w.signIn}>Connect wallet</Button>
        </Card>
      </Container>
    );
  if (m.data === null)
    return (
      <Container className="py-10">
        {header}
        <Card title="Capital">
          Register as a merchant first.{" "}
          <Link className="font-semibold text-ink-700 underline" href="/merchant">
            Go to the merchant page
          </Link>
          .
        </Card>
      </Container>
    );

  const draw = parseUsdc(amount);
  const terms =
    offer?.terms && draw
      ? drawTerms(
          { limit: BigInt(offer.terms.limit), feeBps: offer.terms.fee_bps, repayBps: offer.terms.repay_bps },
          draw,
        )
      : null;
  const limit = offer?.terms ? BigInt(offer.terms.limit) : 0n;
  const tooMuch = draw !== null && limit > 0n && (draw > limit || draw < PROFILE.policy.minLoan);

  return (
    <Container className="py-10">
      {header}
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card title="Steps" className="h-fit lg:sticky lg:top-24">
          <Steps
            items={[
              {
                title: "Underwriter verified",
                body: "Its session key matches the chain.",
                done: !!session,
                current: !session,
              },
              {
                title: "Add evidence (optional)",
                body: "A Stripe test key or statements.",
                done: !!offer,
                current: !!session && !offer,
              },
              { title: "Sign and request", body: "A signed message: free, no transaction.", done: !!offer },
              {
                title: "Review the offer",
                body: "Grade, limit, fee, repay share.",
                current: !!offer && !loanStatus,
              },
              {
                title: "Accept",
                body: "The USDC arrives in your wallet.",
                done: loanStatus === "Active",
                current: !!loanStatus && loanStatus !== "Active",
              },
            ]}
          />
        </Card>
        <div className="space-y-6">
          <Card
            title="Underwriter"
            aside={
              session ? (
                <Badge tone="good">session key matches chain</Badge>
              ) : sessionError ? (
                <Badge tone="bad">check failed</Badge>
              ) : (
                <Badge tone="warn">checking…</Badge>
              )
            }
          >
            {session ? (
              <p className="text-sm">
                Agent <span className="font-mono">{session.served.agent_account}</span> is registered with
                role {session.agent.role}; your request is encrypted to its on-chain session key and only that
                agent can read it.
              </p>
            ) : (
              <ErrorText error={sessionError} />
            )}
          </Card>

          <Card
            title="Evidence (optional)"
            description="Without evidence you can still get a first offer (up to 100 USDC on testnet)."
          >
            <div className="space-y-4">
              <Field
                label="Stripe restricted key (read-only)"
                type="password"
                value={stripeKey}
                onChange={(e) => setStripeKey(e.target.value)}
                hint="rk_test_… on testnet (test mode, not real KYC). Used once inside the agent, never stored."
              />
              <label className="block text-sm">
                <span className="mb-1.5 block font-semibold text-ink-900">
                  Statements (CSV or PDF, up to 3)
                </span>
                <input
                  type="file"
                  multiple
                  accept=".csv,.pdf,text/csv,application/pdf"
                  onChange={(e) => setFiles([...(e.target.files ?? [])])}
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sand-300"
                />
                <span className="mt-1 block text-xs text-subtle">
                  Read by NEAR AI private inference, verified by attestation. Affects corroboration only (up
                  to +10 points).
                </span>
              </label>
              <Explain title="What happens when you press the button">
                <p>
                  1. Your wallet signs a message proving you control this merchant (NEP-413: no transaction,
                  no fee).
                </p>
                <p>
                  2. Your browser encrypts the request to the underwriter&apos;s session key, which it just
                  checked on-chain.
                </p>
                <p>
                  3. The agent reads your revenue from the chain (two RPCs must agree), scores it, and records
                  the offer on the credit contract, which checks it against the policy.
                </p>
                <p>
                  4. The page re-computes the offer&apos;s commitment to make sure nothing was changed on the
                  way.
                </p>
              </Explain>
              <Button onClick={ask} disabled={!session || busy || !m.data}>
                {busy && !offer ? "Working… (10–40 seconds)" : "Sign and request an offer"}
              </Button>
            </div>
          </Card>

          {offer && (
            <Card
              title={offer.decision === "offer" ? `Offer #${offer.offer_id}` : "Declined"}
              className="animate-fade-up"
              aside={
                offer.commitmentOk !== undefined && (
                  <Badge tone={offer.commitmentOk ? "good" : "bad"}>
                    {offer.commitmentOk ? "commitment verified" : "commitment mismatch"}
                  </Badge>
                )
              }
            >
              {offer.terms && (
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Grade"
                    value={offer.terms.grade}
                    help="A, B or C from your revenue score. It sets the fee and how much of your median window can be lent."
                  />
                  <Stat
                    label="Limit"
                    value={fmtUsdc(offer.terms.limit)}
                    help="The most you can draw. First loans without an identity anchor are capped at 100 USDC on testnet."
                  />
                  <Stat
                    label="Fee"
                    value={bps(offer.terms.fee_bps)}
                    help="A flat fee added once to what you draw: A 4%, B 7%, C 10%."
                  />
                  <Stat
                    label="Repay share"
                    value={bps(offer.terms.repay_bps)}
                    help="The share of each sale that repays the loan. Drawing less than the limit lowers it."
                  />
                </div>
              )}
              <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
                {offer.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {offer.decision !== "offer" && (
                <Callout tone="tip">
                  See why with your numbers in the{" "}
                  <Link className="font-semibold underline" href="/simulator#offer">
                    offer simulator
                  </Link>
                  . The usual fix: one equal payment in each of 3 windows in a row, then ask in the next
                  window.
                </Callout>
              )}
              {offer.decision === "offer" && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-3">
                    <Field
                      label="Amount to draw (USDC)"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      hint={`Between ${fmtUsdc(PROFILE.policy.minLoan, 0)} and ${fmtUsdc(limit)}`}
                    />
                    {limit > 0n && (
                      <input
                        type="range"
                        min={Number(PROFILE.policy.minLoan / 1_000_000n)}
                        max={Number(limit / 1_000_000n)}
                        value={Math.min(
                          Number(limit / 1_000_000n),
                          Math.max(
                            Number(PROFILE.policy.minLoan / 1_000_000n),
                            Number((draw ?? 0n) / 1_000_000n),
                          ),
                        )}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full"
                        aria-label="draw amount slider"
                      />
                    )}
                    <Button onClick={accept} disabled={busy || !parseUsdc(amount) || tooMuch}>
                      Accept
                    </Button>
                    {loanStatus && (
                      <ol className="flex flex-wrap gap-3 text-sm" aria-label="loan state">
                        {STATES.map((s) => (
                          <li
                            key={s}
                            className={s === loanStatus ? "font-semibold text-ink-900" : "text-subtle"}
                          >
                            {STATES.indexOf(s) <= STATES.indexOf(loanStatus) ? "✔" : "○"} {s}
                          </li>
                        ))}
                        {loanStatus === "Failed" && <li className="text-bad">Failed (liquidity released)</li>}
                      </ol>
                    )}
                    {loanStatus === "Active" && (
                      <Callout tone="good" title="The USDC is in your wallet">
                        Now repay: each 5-minute period needs at least 10% of what you owe. The easiest way is
                        one large payment from your{" "}
                        <Link className="font-semibold underline" href="/merchant">
                          dashboard
                        </Link>
                        &apos;s payment link.
                      </Callout>
                    )}
                  </div>
                  <Preview title="If you draw this amount">
                    {terms && !tooMuch ? (
                      <>
                        <Row label="You receive" value={`${fmtUsdc(draw!)} USDC`} strong />
                        <Row label={`Fee (${bps(offer.terms!.fee_bps)})`} value={fmtUsdc(terms.fee)} />
                        <Row label="You owe in total" value={`${fmtUsdc(terms.owed)} USDC`} strong />
                        <Row label="Repay share of each sale" value={bps(terms.repayBps)} />
                        <Row
                          label="Repaid after about"
                          value={`${fmtUsdc((terms.owed * 10_000n) / BigInt(terms.repayBps), 0)} USDC of sales`}
                        />
                        <Row
                          label="Minimum each 5-minute period"
                          value={`${fmtUsdc(periodRequirement(terms.owed))} USDC`}
                        />
                        <p className="pt-1 text-xs text-subtle">
                          Drawing less than the limit lowers the repay share in proportion (never below 5%).
                          Valid for 1 hour from the offer.
                        </p>
                      </>
                    ) : (
                      <p className="text-warn">Enter an amount between the minimum and the limit.</p>
                    )}
                  </Preview>
                </div>
              )}
            </Card>
          )}
          <ErrorText error={error} />
        </div>
      </div>
    </Container>
  );
}
