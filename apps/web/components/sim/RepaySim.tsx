"use client";
// Repayment simulator: a loan plus a list of sales, split exactly like settle() + apply_regular.
import { useMemo, useState } from "react";
import { bps, fmtUsdc } from "../../lib/format";
import { microOf, periodRequirement, simulateLoan, splitPayment } from "../../lib/sim";
import { Badge, Callout, Explain, Field, Progress, Row } from "../ui";

const PRESETS: [string, string[]][] = [
  ["Worked example", ["400", "99.50", "1200"]],
  ["Steady 400s", ["400", "400", "400", "400"]],
  ["One big sale", ["1200"]],
  ["Small sales", ["100", "100", "100", "100", "100", "100"]],
];

export function RepaySim() {
  const [principal, setPrincipal] = useState("100");
  const [feePct, setFeePct] = useState("10");
  const [sharePct, setSharePct] = useState("9.17");
  const [sales, setSales] = useState<string[]>(["400", "99.50", "1200"]);

  const p = microOf(principal) ?? 0n;
  const pctToBps = (t: string) => Math.min(10_000, Math.max(0, Math.round(Number(t) * 100) || 0));
  const feeBps = pctToBps(feePct);
  const repayBps = pctToBps(sharePct);
  const pays = sales.map((s) => microOf(s) ?? 0n);
  const r = useMemo(
    () => simulateLoan(p, feeBps, repayBps, pays),
    [principal, feePct, sharePct, sales.join(",")],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = r.steps.reduce(
    (t, s) => ({
      repaid: t.repaid + s.applied,
      merchant: t.merchant + s.toMerchant,
      reserve: t.reserve + s.toReserve,
      feeToLenders: t.feeToLenders + (s.feePart - s.toReserve),
    }),
    { repaid: 0n, merchant: 0n, reserve: 0n, feeToLenders: 0n },
  );
  const pct = r.owed > 0n ? Number((totals.repaid * 1000n) / r.owed) / 10 : 0;
  const perPeriod = periodRequirement(r.owed);
  const saleNeeded = repayBps > 0 ? (perPeriod * 10_000n) / BigInt(repayBps) + 1n : 0n;
  const example = splitPayment(pays[0] ?? 0n, repayBps);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Loan (USDC)"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          inputMode="decimal"
          hint="50–100 for a first loan"
        />
        <Field
          label="Fee (%)"
          value={feePct}
          onChange={(e) => setFeePct(e.target.value)}
          inputMode="decimal"
          hint="Grade A 4 · B 7 · C 10"
        />
        <Field
          label="Repay share (%)"
          value={sharePct}
          onChange={(e) => setSharePct(e.target.value)}
          inputMode="decimal"
          hint="Taken from each sale, 5–25"
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-ink-900">Sales after the loan (USDC, in order)</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {sales.map((s, i) => (
            <Field
              key={i}
              label={`Sale ${i + 1}`}
              inputMode="decimal"
              value={s}
              onChange={(e) => setSales(sales.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => sales.length < 12 && setSales([...sales, "400"])}
            className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-sand-100"
          >
            + sale
          </button>
          <button
            onClick={() => sales.length > 1 && setSales(sales.slice(0, -1))}
            className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-sand-100"
          >
            − sale
          </button>
          {PRESETS.map(([name, v]) => (
            <button
              key={name}
              onClick={() => setSales(v)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-sand-400 hover:bg-sand-100"
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {(
          [
            ["You owe", `${fmtUsdc(r.owed)}`, `${fmtUsdc(p)} + ${fmtUsdc(r.fee)} fee`],
            ["Repaid", `${fmtUsdc(totals.repaid)}`, `${pct}% of what you owe`],
            ["Merchant received", fmtUsdc(totals.merchant), "from these sales"],
            ["Lenders earn", fmtUsdc(totals.feeToLenders), `reserve gets ${fmtUsdc(totals.reserve)}`],
          ] as const
        ).map(([k, v, s]) => (
          <div key={k} className="rounded-xl border border-line bg-sand-50 p-3.5">
            <p className="text-xs text-subtle">{k}</p>
            <p className="font-mono text-lg font-semibold text-ink-900">{v}</p>
            <p className="text-xs text-subtle">{s}</p>
          </div>
        ))}
      </div>
      <div>
        <Progress value={pct} tone={pct >= 100 ? "good" : "ink"} />
        <p className="mt-1 text-xs text-subtle">
          {r.loan.repaid === r.owed ? (
            <Badge tone="good">Repaid. Later sales go 100% to the merchant.</Badge>
          ) : (
            `${fmtUsdc(r.owed - r.loan.repaid)} USDC still owed.`
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-ink-700 text-left text-xs uppercase tracking-wider text-sand-200">
            <tr>
              <th className="px-3 py-2.5">Sale</th>
              <th className="px-3 py-2.5">Split</th>
              <th className="px-3 py-2.5 text-right">To the loan</th>
              <th className="px-3 py-2.5 text-right">· principal</th>
              <th className="px-3 py-2.5 text-right">· fee</th>
              <th className="px-3 py-2.5 text-right">Reserve</th>
              <th className="px-3 py-2.5 text-right">Merchant</th>
              <th className="px-3 py-2.5 text-right">Still owed</th>
            </tr>
          </thead>
          <tbody>
            {r.steps.map((s, i) => {
              const loanW = s.inflow > 0n ? Number((s.applied * 1000n) / s.inflow) / 10 : 0;
              return (
                <tr key={i} className="border-t border-line bg-panel odd:bg-sand-50/60">
                  <td className="px-3 py-2 font-mono">{fmtUsdc(s.inflow)}</td>
                  <td className="w-36 px-3 py-2">
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-sand-300">
                      <div className="bar-grow h-full bg-ink-700" style={{ width: `${loanW}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtUsdc(s.applied, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono text-subtle">
                    {fmtUsdc(s.principalPart, 6)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-subtle">{fmtUsdc(s.feePart, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono text-subtle">{fmtUsdc(s.toReserve, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtUsdc(s.toMerchant, 6)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtUsdc(s.remainingAfter, 6)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 text-xs text-subtle">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-ink-700" /> repays the loan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-sand-300" /> goes to the merchant
        </span>
      </div>

      <Callout tone="warn" title="Don't miss a period">
        Each 5-minute loan period must repay at least <strong>{fmtUsdc(perPeriod)} USDC</strong> (10% of what
        you owe). At a {bps(repayBps)} share that means at least one sale of about{" "}
        <strong>{fmtUsdc(saleNeeded)} USDC</strong> per period. One missed period makes the loan Delinquent;
        two make it Defaulted.
      </Callout>

      <Explain title="Show the formulas for the first sale">
        <Row
          label={`Repay part = floor(${fmtUsdc(pays[0] ?? 0n)} × ${repayBps} ÷ 10,000)`}
          value={fmtUsdc(example.repay, 6)}
        />
        <Row label="Merchant part = sale − repay part" value={fmtUsdc(example.merchant, 6)} />
        <Row
          label="Principal part = total repaid × principal ÷ owed − principal already repaid"
          value={fmtUsdc(r.steps[0]?.principalPart ?? 0n, 6)}
        />
        <Row label="Fee part = repay part − principal part" value={fmtUsdc(r.steps[0]?.feePart ?? 0n, 6)} />
        <Row
          label="Reserve = fee part × 10%; lenders get the other 90%"
          value={fmtUsdc(r.steps[0]?.toReserve ?? 0n, 6)}
        />
        <p className="text-xs text-subtle">
          The loan never takes more than is still owed: anything above goes back to the merchant in the same
          payment.
        </p>
      </Explain>
    </div>
  );
}
