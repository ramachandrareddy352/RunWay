"use client";
// /pay/[handle]?amount=<usdc>&memo=<text> (BUILD_PLAN T2.2, T4b.9).
import { getQuote, getStatus, getTokens, type MerchantView } from "@runway/sdk";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/art";
import { PayCrypto, type PayCryptoDeps } from "../../../components/PayCrypto";
import { PayUpi, type UpiDeps } from "../../../components/PayUpi";
import { Badge, Button, Card, Container, ErrorText, Explain, Field, Row } from "../../../components/ui";
import { collect, collectStatus, logPayment, simulatePayment } from "../../../lib/actions";
import { credit, verified } from "../../../lib/chain";
import { DEPLOYMENT, EXPLORER, NETWORK } from "../../../lib/env";
import { bps, fmtUsdc, parseUsdc } from "../../../lib/format";
import { useLiveRate } from "../../../lib/live";
import { splitPayment } from "../../../lib/sim";

function Pay() {
  const { handle } = useParams<{ handle: string }>();
  const q = useSearchParams();
  const { ratePpu } = useLiveRate();
  const [merchant, setMerchant] = useState<MerchantView | null | undefined>(undefined);
  const [repayBps, setRepayBps] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<"crypto" | "upi">("crypto");
  const [amountText, setAmountText] = useState(q.get("amount") ?? "");
  const amount = parseUsdc(amountText);
  const memo = q.get("memo");

  useEffect(() => {
    verified.credit.merchant(handle).then(setMerchant).catch(setError);
  }, [handle]);
  useEffect(() => {
    const id = merchant?.merchant.active_loan;
    if (!id) return;
    credit
      .loan(id)
      .then((l) => l && (l.status === "Active" || l.status === "Delinquent") && setRepayBps(l.repay_bps))
      .catch(() => undefined);
  }, [merchant?.merchant.active_loan]);

  const cryptoDeps = useMemo<PayCryptoDeps>(
    () => ({
      tokens: () => getTokens(),
      quote: (req) => getQuote(req),
      status: (addr) => getStatus(addr),
      simulate:
        NETWORK === "testnet" || NETWORK === "sandbox" ? (a) => simulatePayment(handle, a) : undefined,
      logPayment: (addr) => logPayment(handle, addr),
    }),
    [handle],
  );
  // The receipt is recorded by the gateway contract; its transactions are listed on its explorer page.
  const upiDeps = useMemo<UpiDeps>(
    () => ({ collect, collectStatus, explorerFor: () => `${EXPLORER}/address/${DEPLOYMENT.inr}`, ratePpu }),
    [ratePpu],
  );

  if (error)
    return (
      <Container className="py-10">
        <ErrorText error={error} />
      </Container>
    );
  if (merchant === undefined)
    return (
      <Container className="py-10">
        <p className="animate-pulse-soft text-sm text-subtle">Looking up {handle} on two RPCs…</p>
      </Container>
    );
  if (merchant === null)
    return (
      <Container className="py-10">
        <Card title="Not found">
          <p className="text-sm">There is no Runway merchant called “{handle}”.</p>
        </Card>
      </Container>
    );
  const split = amount ? splitPayment(amount, repayBps) : null;
  return (
    <Container className="py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <div className="animate-fade-up">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sand-600">Payment</p>
            <h1 className="text-3xl font-semibold text-ink-900 sm:text-4xl">Pay {handle}</h1>
            {memo && <p className="mt-1 text-sm text-subtle">For: {memo}</p>}
            <p className="mt-2 text-xs text-subtle">
              Settles to <span className="font-mono">{merchant.merchant.settlement}</span> (a keyless account;
              read from two RPCs).
            </p>
          </div>
          {!q.get("amount") && (
            <Field
              label="Amount (USDC)"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
            />
          )}
          <div className="flex gap-2" role="tablist">
            <Button
              role="tab"
              aria-selected={tab === "crypto"}
              variant={tab === "crypto" ? "primary" : "secondary"}
              onClick={() => setTab("crypto")}
            >
              <Icon name="coins" className="h-4 w-4" /> Crypto
            </Button>
            <Button
              role="tab"
              aria-selected={tab === "upi"}
              variant={tab === "upi" ? "primary" : "secondary"}
              onClick={() => setTab("upi")}
            >
              <Icon name="rupee" className="h-4 w-4" /> UPI (₹)
            </Button>
          </div>
          {tab === "crypto" ? (
            amount && amount > 0n ? (
              <PayCrypto
                handle={handle}
                settlement={merchant.merchant.settlement}
                amount={amount}
                mode="preview"
                deps={cryptoDeps}
              />
            ) : (
              <p className="text-sm text-subtle">Enter an amount to pay.</p>
            )
          ) : (
            <PayUpi handle={handle} deps={upiDeps} />
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:h-fit">
          <Card title="Where your payment goes">
            {split ? (
              <div className="space-y-3 text-sm">
                <div className="flex h-3 overflow-hidden rounded-full bg-sand-300">
                  <div
                    className="h-full bg-ink-700 transition-[width] duration-500"
                    style={{ width: `${amount ? Number((split.repay * 1000n) / amount) / 10 : 0}%` }}
                  />
                </div>
                <Row label="To the merchant" value={`${fmtUsdc(split.merchant)} USDC`} strong />
                <Row
                  label={repayBps ? `Repays their loan (${bps(repayBps)})` : "Repays a loan"}
                  value={`${fmtUsdc(split.repay)} USDC`}
                />
                <p className="text-xs text-subtle">
                  {repayBps
                    ? "This merchant has a loan, so a fixed share of your payment repays it automatically. You pay the same price."
                    : "This merchant has no loan right now, so all of it goes to them."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-subtle">Enter an amount to see the split.</p>
            )}
          </Card>
          <Explain title="Is this safe?">
            <p>
              The payment goes to {handle}&apos;s settlement account, which has no keys: nobody can take money
              out of it except by the fixed split rules. Your browser read it from two independent RPCs, which
              had to agree.
            </p>
            <p>
              Crypto quotes are checked in your browser before anything can be paid. UPI payments are
              confirmed by the INR gateway, which records an on-chain receipt.
            </p>
          </Explain>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="warn">testnet · simulated money</Badge>
            <a className="font-semibold text-ink-700 underline" href="/docs/customers">
              How paying works
            </a>
          </div>
        </aside>
      </div>
    </Container>
  );
}

export default function PayPage() {
  return (
    <Suspense>
      <Pay />
    </Suspense>
  );
}
