"use client";
// /merchant (BUILD_PLAN T5.2): register, payment link + QR, routed revenue, loan card, record,
// claim_payout, update_payout, plus a "next step" guide that reads the merchant's on-chain state.
import { completeBuckets, type LoanView } from "@runway/sdk";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState, type ReactNode } from "react";
import { Icon } from "../../components/art";
import { useNow } from "../../components/motion";
import { RevenueChart, type BucketPoint } from "../../components/RevenueChart";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  ErrorText,
  Explain,
  Field,
  LinkButton,
  PageHeader,
  Preview,
  Progress,
  Row,
  Stat,
  Steps,
} from "../../components/ui";
import { claimPayout, registerMerchant, updatePayout } from "../../lib/actions";
import { credit, settlements, storageOf } from "../../lib/chain";
import { DEPLOYMENT, PROFILE } from "../../lib/env";
import { bps, fmtUsdc } from "../../lib/format";
import { estimateOffer, mmss, periodRequirement, windowClock } from "../../lib/sim";
import { useAsync } from "../../lib/useAsync";
import { useWallet } from "../../lib/wallet";

type FullLoan = LoanView & { period_end_sec?: number; repaid_in_period?: string; missed?: number };

const STATUS_TEXT: Record<string, string> = {
  PendingTerms: "Setting the repay share on your settlement account…",
  PendingTransfer: "Sending the USDC to you…",
  Active: "On track. A share of every sale repays it.",
  Delinquent: "A period was missed. Repay at least the minimum this period to get back on track.",
  Repaid: "Fully repaid.",
  Defaulted: "Two periods were missed in a row. No new loans for this merchant.",
  Failed: "The USDC couldn't be delivered, so the loan was cancelled. You owe nothing.",
};

export default function MerchantPage() {
  const w = useWallet();
  const now = useNow();
  const [handle, setHandle] = useState("");
  const [newPayout, setNewPayout] = useState("");
  const [amount, setAmount] = useState("400");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [txError, setTxError] = useState<unknown>(null);
  const m = useAsync(
    () => (w.accountId ? credit.merchantByAccount(w.accountId) : Promise.resolve(null)),
    [w.accountId],
  );
  const usdcReady = useAsync(
    () =>
      w.accountId ? storageOf(DEPLOYMENT.token, w.accountId).then((s) => s !== null) : Promise.resolve(false),
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
    return { state, buckets, loan: loan as FullLoan | null };
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

  // ---------- not connected ----------
  if (!w.accountId)
    return (
      <Container className="py-10">
        <PageHeader eyebrow="Merchants" title="Get paid. Get capital. Repay from sales.">
          Accept crypto and UPI through one link, let your sales build a credit record, and borrow against it.
          You repay with a share of each sale, automatically.
        </PageHeader>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card title="How it works for you">
            <Steps
              items={[
                { title: "Connect your wallet", body: "The wallet you connect is where your money arrives." },
                {
                  title: "Register a handle",
                  body: "Runway creates a keyless settlement account for your payments (about 2 NEAR).",
                },
                {
                  title: "Share your payment link",
                  body: "Customers pay crypto or UPI; you get USDC (or rupees) within seconds.",
                },
                {
                  title: "Get an offer after 3 windows",
                  body: "A private underwriter turns your revenue into a credit limit.",
                },
                {
                  title: "Repay automatically",
                  body: "A fixed share of every sale repays the loan until it's done.",
                },
              ]}
            />
          </Card>
          <div className="space-y-4">
            <Card title="Start here">
              <p className="mb-4 text-sm text-subtle">Connect the wallet that should receive your payouts.</p>
              <Button onClick={w.signIn}>Connect wallet</Button>
            </Card>
            <Callout tone="tip" title="New to testnet?">
              You need a NEAR testnet wallet (Meteor works best) with about 4 NEAR from{" "}
              <a
                className="font-semibold underline"
                href="https://near-faucet.io"
                target="_blank"
                rel="noreferrer"
              >
                near-faucet.io
              </a>
              . Everything else is free.{" "}
              <Link className="font-semibold underline" href="/docs/merchants">
                Read the merchant guide
              </Link>
              .
            </Callout>
            <Card
              title="Not sure what you'd get?"
              description="Type a few windows of sales and see the offer the underwriter would compute."
            >
              <LinkButton href="/simulator#offer" variant="secondary">
                <Icon name="calc" /> Try the offer simulator
              </LinkButton>
            </Card>
          </div>
        </div>
      </Container>
    );

  if (m.loading && merchant === undefined)
    return (
      <Container className="py-10">
        <p className="animate-pulse-soft text-sm text-subtle">Looking up your merchant account…</p>
      </Container>
    );

  const usdcWarning = usdcReady.data === false && (
    <Callout tone="warn" title="Step 0: get test USDC first">
      Your wallet isn&apos;t registered with the USDC token yet, so it can&apos;t receive your sales or a
      loan. Open{" "}
      <Link className="font-semibold underline" href="/lend">
        Lenders
      </Link>{" "}
      and press “Get 1,000 test USDC”: it registers your wallet too. Then come back.
    </Callout>
  );

  // ---------- register ----------
  if (!merchant) {
    const valid = /^[a-z0-9]{2,32}$/.test(handle);
    return (
      <Container className="py-10">
        <PageHeader eyebrow="Merchants · step 1 of 5" title="Register your payment handle">
          Your handle names your payment link and your settlement account. Choose something your customers
          will recognise.
        </PageHeader>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card title="Register as a merchant">
            <div className="space-y-4">
              {usdcWarning}
              <p className="text-sm">
                Pick a handle. Runway creates <span className="font-mono">&lt;handle&gt;.pay.…</span>, a
                keyless settlement account that splits every payment between your loan (if any) and you. The
                deposit (about 2 NEAR) pays for that account&apos;s storage.
              </p>
              <Field
                label="Handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                hint="2–32 lowercase letters or digits"
              />
              <Button disabled={!valid || busy} onClick={() => run(() => registerMerchant(w, handle))}>
                Register {handle || "…"}
              </Button>
              <ErrorText error={txError ?? m.error} />
            </div>
          </Card>
          <Preview>
            {handle ? (
              valid ? (
                <>
                  <Row label="Payment link" value={`/pay/${handle}`} />
                  <Row label="Settlement account" value={`${handle}.${DEPLOYMENT.factory}`} />
                  <Row label="Payouts go to" value={w.accountId} />
                  <Row label="Deposit (storage)" value="≈ 2.00125 NEAR" />
                  <p className="pt-2 text-xs text-subtle">
                    The settlement account has no keys: nobody, Runway included, can move money out of it
                    except by the split rules.
                  </p>
                </>
              ) : (
                <p className="text-warn">Only lowercase letters and digits, 2 to 32 characters.</p>
              )
            ) : (
              <p className="text-subtle">Type a handle to see the accounts it creates.</p>
            )}
          </Preview>
        </div>
      </Container>
    );
  }

  // ---------- dashboard ----------
  const h = merchant.merchant.handle;
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/pay/${h}?amount=${amount}` : `/pay/${h}`;
  const current = chain.data ? BigInt(chain.data.state.current_bucket) : 0n;
  const done = chain.data ? completeBuckets(chain.data.buckets, current) : [];
  const first = current - BigInt(done.length);
  const currentInflow = BigInt(chain.data?.buckets.find((b) => BigInt(b.bucket) === current)?.inflow ?? "0");
  const points: BucketPoint[] = [
    ...done.map((v, i) => ({ bucket: first + BigInt(i), inflow: v, current: false })),
    ...(chain.data ? [{ bucket: current, inflow: currentInflow, current: true }] : []),
  ];
  const loan = chain.data?.loan;
  const repaidPct = loan ? Number((BigInt(loan.repaid) * 1000n) / BigInt(loan.owed)) / 10 : 0;
  const clock = windowClock(now);
  const est = estimateOffer(done, {
    repaid: merchant.record.loans_repaid,
    anchored: merchant.merchant.anchor !== null,
    defaulted: merchant.record.loans_defaulted > 0,
  });
  const withRevenue = est.features.H;
  const loanOpen = loan && (loan.status === "Active" || loan.status === "Delinquent");

  // The single next thing to do, from the on-chain state.
  let next: { tone: "info" | "tip" | "warn" | "good"; title: string; body: ReactNode; cta?: ReactNode };
  const payCta = (
    <LinkButton href={`/pay/${h}?amount=${amount}`} external variant="primary">
      <Icon name="link" /> Open my payment link
    </LinkButton>
  );
  if (loanOpen) {
    const need = periodRequirement(BigInt(loan.owed), BigInt(loan.owed) - BigInt(loan.repaid));
    const inPeriod = BigInt(loan.repaid_in_period ?? "0");
    const left = (loan.period_end_sec ?? 0) - Math.floor(now / 1000);
    next =
      inPeriod >= need
        ? {
            tone: "good",
            title: `This period's minimum is covered (${fmtUsdc(inPeriod)} of ${fmtUsdc(need)})`,
            body: `Keep selling as usual. The next period starts in ${mmss(left)}. To finish early, pay yourself about ${fmtUsdc(((BigInt(loan.owed) - BigInt(loan.repaid)) * 10_000n) / BigInt(loan.repay_bps) + 1_000_000n, 0)} USDC.`,
            cta: payCta,
          }
        : {
            tone: "warn",
            title: `Repay at least ${fmtUsdc(need - inPeriod)} more in the next ${mmss(left)}`,
            body: `Each period needs ${fmtUsdc(need)} USDC repaid (10% of what you owe). At your ${bps(loan.repay_bps)} share that's a sale of about ${fmtUsdc(((need - inPeriod) * 10_000n) / BigInt(loan.repay_bps) + 1_000_000n, 0)} USDC. Missing two periods in a row defaults the loan.`,
            cta: payCta,
          };
  } else if (merchant.record.loans_defaulted > 0) {
    next = {
      tone: "warn",
      title: "This merchant has a default on record",
      body: "New offers are blocked for this handle.",
    };
  } else if (est.decision.kind === "offer") {
    next = {
      tone: "good",
      title: `You can ask for an offer now (estimate: grade ${est.decision.grade}, ${fmtUsdc(est.decision.limit, 0)} USDC)`,
      body:
        currentInflow === 0n
          ? `Ask within ${mmss(clock.secondsLeft)}, before this window ends empty and makes your history look uneven.`
          : "Your history looks steady. The underwriter makes the final decision.",
      cta: (
        <LinkButton href="/merchant/capital" variant="primary">
          <Icon name="bolt" /> Request an offer
        </LinkButton>
      ),
    };
  } else if (est.decision.reason === "too_new") {
    next = {
      tone: "tip",
      title: `${withRevenue} of 3 windows with revenue`,
      body:
        currentInflow > 0n
          ? `This window already has ${fmtUsdc(currentInflow)} USDC. Make your next payment in the next window, which starts in ${mmss(clock.secondsLeft)}.`
          : `Pay yourself ${amount} USDC now, in this window (it ends in ${mmss(clock.secondsLeft)}). Use the same amount in each window.`,
      cta: currentInflow > 0n ? undefined : payCta,
    };
  } else if (est.decision.reason === "low_revenue") {
    next = {
      tone: "tip",
      title: "Your typical window is below 300 USDC",
      body: "Offers need a median window of at least 300 USDC. Use 400 per window.",
      cta: payCta,
    };
  } else {
    next = {
      tone: "tip",
      title: "Your revenue looks uneven right now",
      body: `Make one equal payment in each of the next windows; the last 6 completed windows count. This window ends in ${mmss(clock.secondsLeft)}.`,
      cta: payCta,
    };
  }

  return (
    <Container className="py-10">
      <PageHeader
        eyebrow="Merchant dashboard"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {h}
            <Badge tone="ink">
              {merchant.merchant.payout_mode === "Inr" ? "payouts in ₹" : "payouts in USDC"}
            </Badge>
            {merchant.merchant.frozen && <Badge tone="bad">frozen</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href="/merchant/capital" variant="secondary">
              Capital
            </LinkButton>
            <LinkButton href="/merchant/settings" variant="secondary">
              Payout settings
            </LinkButton>
          </>
        }
      >
        Payments to <span className="font-mono text-sm">{merchant.merchant.settlement}</span> are split
        on-chain and sent to <span className="font-mono text-sm">{merchant.merchant.payout}</span>.
      </PageHeader>

      <div className="space-y-6">
        {usdcWarning}
        <div className="rounded-2xl bg-ink-700 p-5 text-sand-100 shadow-lg sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-sand-300">Your next step</p>
              <p className="mt-1 font-display text-2xl font-semibold">{next.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-sand-100/80">{next.body}</p>
            </div>
            <div className="rounded-xl border border-sand-300/30 bg-white/5 px-4 py-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-sand-300">This window ends in</p>
              <p className="font-mono text-3xl font-semibold text-sand-200">{mmss(clock.secondsLeft)}</p>
              <p className="text-[11px] text-sand-100/60">
                {PROFILE.bucketSec / 60}-minute windows, on the clock
              </p>
            </div>
          </div>
          {next.cta && <div className="mt-4 [&_a]:!bg-sand-300 [&_a]:!text-ink-900">{next.cta}</div>}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
          <Card title="Payment link" description="Share this with customers. They can pay crypto or UPI.">
            <div className="flex flex-wrap items-start gap-4">
              <div className="rounded-xl bg-white p-2 shadow-sm">
                <QRCodeSVG value={link} size={120} fgColor="#172a2c" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Field label="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <p className="break-all rounded-lg bg-sand-50 p-2 font-mono text-xs">{link}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? "Copied ✓" : "Copy link"}
                  </Button>
                  <LinkButton href={`/pay/${h}?amount=${amount}`} external variant="ghost">
                    Open ↗
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>
          <Card
            title="Routed revenue"
            description="Every payment through your link, per window. Completed windows build your offer."
            aside={
              <div className="text-right text-xs text-subtle">
                <Badge tone={withRevenue >= 3 ? "good" : "neutral"}>{withRevenue} windows with revenue</Badge>
              </div>
            }
          >
            <RevenueChart points={points} source={PROFILE.revenueSource} />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card
            title="Loan"
            description={loan ? STATUS_TEXT[loan.status] : "Borrow against your revenue; repay from sales."}
          >
            {loan ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Status"
                    value={loan.status}
                    help="Active → (Delinquent if a period is missed) → Repaid. Two misses in a row → Defaulted."
                  />
                  <Stat label="Principal" value={fmtUsdc(loan.principal)} help="What you borrowed." />
                  <Stat label="Owed" value={fmtUsdc(loan.owed)} help="Principal plus the flat fee." />
                  <Stat
                    label="Repay share"
                    value={bps(loan.repay_bps)}
                    sub="of each payment"
                    help="This share of every payment repays the loan, automatically."
                  />
                </div>
                <div aria-label="repayment progress">
                  <Progress value={repaidPct} tone={repaidPct >= 100 ? "good" : "ink"} />
                </div>
                <p className="text-sm">
                  Repaid {fmtUsdc(loan.repaid)} of {fmtUsdc(loan.owed)} ({repaidPct}%).
                </p>
                {loanOpen && loan.period_end_sec !== undefined && (
                  <Explain title="This loan period">
                    <Row label="Period ends in" value={mmss(loan.period_end_sec - Math.floor(now / 1000))} />
                    <Row label="Repaid this period" value={`${fmtUsdc(loan.repaid_in_period ?? "0")} USDC`} />
                    <Row
                      label="Needed this period (10% of owed)"
                      value={`${fmtUsdc(periodRequirement(BigInt(loan.owed), BigInt(loan.owed) - BigInt(loan.repaid)))} USDC`}
                    />
                    <Row label="Missed periods in a row" value={String(loan.missed ?? 0)} />
                  </Explain>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p>
                  No active loan.{" "}
                  <a className="font-semibold text-ink-700 underline" href="/merchant/capital">
                    Ask for an offer
                  </a>
                  .
                </p>
                {est.decision.kind === "offer" ? (
                  <Preview title="If you asked now (estimate)">
                    <Row label="Grade" value={est.decision.grade} />
                    <Row label="Limit" value={`${fmtUsdc(est.decision.limit)} USDC`} />
                    <Row label="Fee" value={`${bps(est.decision.feeBps)} (${fmtUsdc(est.decision.fee)})`} />
                    <Row label="Repay share" value={bps(est.decision.repayBps)} />
                    <p className="pt-1 text-xs text-subtle">
                      Computed in your browser with the underwriter&apos;s own scoring from your completed
                      windows. The agent decides.
                    </p>
                  </Preview>
                ) : (
                  <p className="text-subtle">
                    An estimate appears here once you have 3 windows of revenue. See why in the{" "}
                    <Link className="font-semibold underline" href="/simulator#offer">
                      offer simulator
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
          </Card>
          <div className="space-y-6">
            <Card
              title="Credit record"
              description="Your history with Runway. More repaid loans mean higher limits."
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Loans repaid" value={merchant.record.loans_repaid} />
                <Stat label="Defaults" value={merchant.record.loans_defaulted} />
                <Stat label="Borrowed" value={fmtUsdc(merchant.record.total_borrowed)} />
                <Stat label="Repaid" value={fmtUsdc(merchant.record.total_repaid)} />
              </div>
            </Card>
            <Card title="Payout" description="Where your share of each payment goes.">
              <div className="space-y-3">
                <p className="text-sm">
                  Claimable: <span className="font-mono">{fmtUsdc(merchant.claimable)}</span> USDC (payouts
                  that couldn&apos;t be delivered).
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
                <p className="text-xs text-subtle">
                  Careful: the payout account is also the wallet that manages this merchant (it accepts
                  offers). Only change it to a wallet you control.
                </p>
              </div>
            </Card>
          </div>
        </div>
        <ErrorText error={txError ?? chain.error} />
      </div>
    </Container>
  );
}
