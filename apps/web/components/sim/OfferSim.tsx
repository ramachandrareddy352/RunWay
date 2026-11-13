"use client";
// Offer simulator: revenue windows in, the underwriter's own scoring out, with every step shown.
import { useMemo, useState } from "react";
import { PROFILE } from "../../lib/env";
import { bps, fmtUsdc } from "../../lib/format";
import { estimateOffer, GRADE_FEE_BPS, microOf, MIN_ACTIVE_WINDOWS, MIN_MEDIAN_REVENUE } from "../../lib/sim";
import { Button, Callout, Explain, Field, Progress, Row } from "../ui";

const PRESETS: [string, string[]][] = [
  ["Steady: 400 × 3", ["400", "400", "400"]],
  ["Growing", ["300", "400", "500"]],
  ["Unsteady", ["900", "100", "400"]],
  ["Too new: 2 windows", ["400", "400"]],
  ["Asked one window late", ["400", "400", "400", "0"]],
  ["Big & steady: 2,000 × 6", ["2000", "2000", "2000", "2000", "2000", "2000"]],
];

const DECLINE_TEXT: Record<string, string> = {
  too_new: `Needs revenue in at least ${MIN_ACTIVE_WINDOWS} windows.`,
  low_revenue: `The median window must be at least ${fmtUsdc(MIN_MEDIAN_REVENUE, 0)} USDC.`,
  low_score: "Revenue isn't steady enough: the score is below 40.",
  defaulted: "A merchant with a default on record gets no new offers.",
  frozen: "The merchant is frozen.",
  concentrated: "Too much revenue comes from one payer (over 60%).",
  below_min_loan: "The limit works out below the 50 USDC minimum loan.",
};

const K: Record<string, string> = { A: "1.0", B: "0.6", C: "0.3" };

export function OfferSim({ compact = false }: { compact?: boolean }) {
  const [windows, setWindows] = useState<string[]>(["400", "400", "400"]);
  const [repaid, setRepaid] = useState(0);
  const [statement, setStatement] = useState(false);

  const micro = windows.map((w) => microOf(w) ?? 0n);
  const est = useMemo(() => {
    const first = estimateOffer(micro);
    return statement
      ? estimateOffer(micro, { repaid, statementMedian: first.features.R })
      : estimateOffer(micro, { repaid });
  }, [windows.join(","), repaid, statement]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = est.decision;
  const f = est.features;
  const caps = PROFILE.policy.unanchoredCaps;
  const cap = caps[Math.min(repaid, 3)]!;
  const shown = (v: bigint) => fmtUsdc(v);

  const parts: [string, number, number, string][] = [
    [
      "Stability",
      est.parts.stability,
      35,
      `How even your windows are (CV ${(Number(f.CV) / 1e6).toFixed(2)}; 0 is perfectly even).`,
    ],
    ["History", est.parts.history, 25, `Loans repaid before: ${repaid} of 4 counted.`],
    [
      "Diversity",
      est.parts.diversity,
      15,
      "Many different payers. Unknown for crypto payments on testnet, so 0.",
    ],
    [
      "Trend",
      est.parts.trend,
      15,
      `Last 2 windows vs earlier ones: × ${(Number(f.T) / 1e6).toFixed(2)} (1.00 = flat).`,
    ],
    [
      "Corroboration",
      est.parts.corr,
      10,
      statement
        ? "A statement matches your revenue: +5."
        : "Upload a bank or Stripe statement to add up to 10.",
    ],
  ];

  return (
    <div className={`grid gap-6 ${compact ? "" : "lg:grid-cols-[1fr_1.1fr]"}`}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">Revenue per 5-minute window (USDC)</p>
          <p className="mb-3 text-xs text-subtle">
            Oldest first. The underwriter looks at completed windows only, up to the last 6, starting from
            your first sale. An empty window counts as 0.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {windows.map((w, i) => (
              <Field
                key={i}
                label={`W${i + 1}`}
                inputMode="decimal"
                value={w}
                onChange={(e) => setWindows(windows.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              disabled={windows.length >= 6}
              onClick={() => setWindows([...windows, "400"])}
            >
              + window
            </Button>
            <Button
              variant="ghost"
              disabled={windows.length <= 1}
              onClick={() => setWindows(windows.slice(0, -1))}
            >
              − window
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(([name, w]) => (
            <button
              key={name}
              onClick={() => setWindows(w)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-sand-400 hover:bg-sand-100"
            >
              {name}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="mb-1.5 flex justify-between font-semibold text-ink-900">
            Loans repaid before <span className="font-mono">{repaid}</span>
          </span>
          <input
            type="range"
            min={0}
            max={4}
            value={repaid}
            onChange={(e) => setRepaid(Number(e.target.value))}
            className="w-full"
          />
          <span className="text-xs text-subtle">
            More repaid loans raise the score and the cap: {caps.map((c) => fmtUsdc(c, 0)).join(" → ")} USDC.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={statement} onChange={(e) => setStatement(e.target.checked)} />I
          attach a statement that matches this revenue (NEAR AI reads it privately)
        </label>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl bg-ink-700 p-5 text-sand-100 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-sand-300">
              The underwriter would say
            </p>
            {d.kind === "offer" ? (
              <span className="rounded-full bg-sand-300 px-2.5 py-0.5 text-xs font-bold text-ink-900">
                Offer
              </span>
            ) : (
              <span className="rounded-full bg-[#f2b8a8] px-2.5 py-0.5 text-xs font-bold text-ink-900">
                Declined
              </span>
            )}
          </div>
          {d.kind === "offer" ? (
            <div className="mt-3 flex items-end gap-5">
              <div className="font-display text-6xl font-semibold text-sand-300">{d.grade}</div>
              <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-sand-100/70">Limit</span>
                <span className="text-right font-mono">{shown(d.limit)} USDC</span>
                <span className="text-sand-100/70">Fee</span>
                <span className="text-right font-mono">
                  {bps(d.feeBps)} = {shown(d.fee)}
                </span>
                <span className="text-sand-100/70">You repay</span>
                <span className="text-right font-mono">{shown(d.owed)} USDC</span>
                <span className="text-sand-100/70">Repay share</span>
                <span className="text-right font-mono">{bps(d.repayBps)} of each sale</span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm">{DECLINE_TEXT[d.reason] ?? d.reasons.join("; ")}</p>
          )}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-sand-100/70">
              <span>Score {est.score.toFixed(2)} / 100</span>
              <span>C ≥ 40 · B ≥ 55 · A ≥ 75</span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-ink-900/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sand-500 to-sand-300 transition-[width] duration-700"
                style={{ width: `${Math.min(100, est.score)}%` }}
              />
              {[40, 55, 75].map((t) => (
                <span
                  key={t}
                  className="absolute top-0 h-full w-px bg-sand-100/50"
                  style={{ left: `${t}%` }}
                />
              ))}
            </div>
          </div>
          {d.kind === "offer" && (
            <p className="mt-3 text-xs text-sand-100/75">
              With a {bps(d.repayBps)} share, the {shown(d.owed)} USDC is repaid after about{" "}
              <strong className="text-sand-300">{shown((d.owed * 10_000n) / BigInt(d.repayBps))} USDC</strong>{" "}
              of sales, about 3 windows of your median revenue.
            </p>
          )}
        </div>

        {!compact && (
          <div className="space-y-3 rounded-2xl border border-line bg-panel p-5">
            <p className="text-sm font-semibold text-ink-900">Where the score comes from</p>
            {parts.map(([name, pts, max, why]) => (
              <div key={name}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{name}</span>
                  <span className="font-mono">
                    {pts.toFixed(2)} / {max}
                  </span>
                </div>
                <Progress value={(pts / max) * 100} />
                <p className="mt-0.5 text-xs text-subtle">{why}</p>
              </div>
            ))}
          </div>
        )}

        <Explain title="Show the formulas with these numbers">
          <Row label="Median window R" value={`${shown(f.R)} USDC`} />
          <Row label={`Windows with revenue (need ${MIN_ACTIVE_WINDOWS})`} value={`${f.H} of ${f.n}`} />
          {d.kind === "offer" && (
            <>
              <Row
                label={`R × k(${d.grade}) = ${shown(f.R)} × ${K[d.grade]}`}
                value={shown((f.R * BigInt(Math.round(Number(K[d.grade]) * 10))) / 10n)}
              />
              <Row label={`Tier cap (${repaid} loans repaid, no identity anchor)`} value={fmtUsdc(cap)} />
              <Row
                label="Repayable in 3 windows at the max 25% share"
                value={shown((3n * f.R * 2500n) / (10_000n + BigInt(GRADE_FEE_BPS[d.grade])))}
              />
              <Row label="Limit = the smallest of these (and 15,000 max)" value={shown(d.limit)} strong />
              <Row label={`Fee = limit × ${bps(d.feeBps)}`} value={shown(d.fee)} />
              <Row label="Repay share = owed ÷ (3 × R), between 5% and 25%" value={bps(d.repayBps)} strong />
            </>
          )}
          <p className="text-xs text-subtle">
            Same code as the underwriter agent (<code>@runway/scoring</code>). The real offer also checks your
            identity anchor, payer diversity from UPI receipts and statements, so it can differ a little.
          </p>
        </Explain>
        {d.kind === "decline" && d.reason === "low_score" && (
          <Callout tone="tip">
            Make one equal payment per window, and ask for the offer in the very next window, so no empty
            window enters your history.
          </Callout>
        )}
      </div>
    </div>
  );
}
