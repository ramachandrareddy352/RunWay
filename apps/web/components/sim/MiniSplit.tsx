"use client";
// Home-page teaser: drag a sale amount, see it split live.
import { useState } from "react";
import { fmtUsdc } from "../../lib/format";
import { splitPayment } from "../../lib/sim";

export function MiniSplit() {
  const [sale, setSale] = useState(400);
  const [loan, setLoan] = useState(true);
  const repayBps = loan ? 917 : null;
  const s = splitPayment(BigInt(sale) * 1_000_000n, repayBps);
  const loanPct = sale > 0 ? (Number(s.repay) / (sale * 1_000_000)) * 100 : 0;
  return (
    <div className="rounded-2xl border border-line bg-panel p-6 shadow-[0_20px_50px_-30px_rgba(23,42,44,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-lg font-semibold text-ink-900">Try it: one customer payment</p>
        <div className="flex rounded-xl border border-line bg-sand-50 p-1 text-xs font-semibold">
          <button
            onClick={() => setLoan(false)}
            className={`rounded-lg px-3 py-1.5 transition ${!loan ? "bg-ink-700 text-sand-300" : "text-ink-700"}`}
          >
            No loan
          </button>
          <button
            onClick={() => setLoan(true)}
            className={`rounded-lg px-3 py-1.5 transition ${loan ? "bg-ink-700 text-sand-300" : "text-ink-700"}`}
          >
            Loan open (9.17% share)
          </button>
        </div>
      </div>
      <label className="mt-5 block text-sm">
        <span className="mb-2 flex justify-between font-semibold text-ink-900">
          Customer pays <span className="font-mono">{sale.toLocaleString("en-US")} USDC</span>
        </span>
        <input
          type="range"
          min={10}
          max={2000}
          step={10}
          value={sale}
          onChange={(e) => setSale(Number(e.target.value))}
          className="w-full"
        />
      </label>
      <div className="mt-5 flex h-12 overflow-hidden rounded-xl bg-sand-300 text-xs font-semibold">
        <div
          className="flex items-center justify-center bg-ink-700 text-sand-300 transition-[width] duration-500"
          style={{ width: `${loanPct}%` }}
        >
          {loanPct > 6 ? "loan" : ""}
        </div>
        <div className="flex flex-1 items-center justify-center text-ink-900">merchant</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-ink-50 p-3">
          <p className="text-xs text-subtle">Repays the loan (to lenders)</p>
          <p className="font-mono text-xl font-semibold text-ink-900">{fmtUsdc(s.repay)}</p>
        </div>
        <div className="rounded-xl bg-sand-100 p-3">
          <p className="text-xs text-subtle">Goes to the merchant</p>
          <p className="font-mono text-xl font-semibold text-ink-900">{fmtUsdc(s.merchant)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        {loan
          ? "While a loan is open, a fixed share of every payment repays it automatically, on-chain. Slow week? You repay less."
          : "With no loan, 100% of every payment goes straight to the merchant. Runway takes nothing."}
      </p>
    </div>
  );
}
