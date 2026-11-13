"use client";
// Lender simulator: deposit → shares → value after a repaid, delinquent or defaulted loan.
import { useEffect, useState } from "react";
import { fmtUsdc } from "../../lib/format";
import { useVault } from "../../lib/live";
import {
  assetsForShares,
  defaultLoss,
  microOf,
  provisionFor,
  sharePrice1e6,
  sharesForDeposit,
} from "../../lib/sim";
import { Badge, Explain, Field, Row } from "../ui";

type Outcome = "repaid" | "delinquent" | "default";

export function LenderSim() {
  const vault = useVault();
  const [deposit, setDeposit] = useState("1000");
  const [nav, setNav] = useState("10000");
  const [shares, setShares] = useState("10000");
  const [reserve, setReserve] = useState("100");
  const [loan, setLoan] = useState("100");
  const [feePct, setFeePct] = useState("10");
  const [outcome, setOutcome] = useState<Outcome>("repaid");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const v = vault.data;
    if (!v || live) return;
    setNav(fmtUsdc(v.total_assets, 6).replace(/,/g, ""));
    setShares(fmtUsdc(v.total_shares, 6).replace(/,/g, ""));
    setReserve(fmtUsdc(v.reserve, 6).replace(/,/g, ""));
    setLive(true);
  }, [vault.data, live]);

  const A = microOf(nav) ?? 0n;
  const S = microOf(shares) ?? 0n;
  const D = microOf(deposit) ?? 0n;
  const L = microOf(loan) ?? 0n;
  const R = microOf(reserve) ?? 0n;
  const feeBps = BigInt(Math.min(10_000, Math.max(0, Math.round(Number(feePct) * 100) || 0)));

  const mine = sharesForDeposit(D, S, A);
  const A1 = A + D;
  const S1 = S + mine;
  const fee = (L * feeBps) / 10_000n;
  const lenderFee = fee - fee / 10n; // 90% of the fee; 10% goes to the reserve
  const provision = provisionFor(L, 0n);
  const loss = defaultLoss(L, R);
  const A2 =
    outcome === "repaid" ? A1 + lenderFee : outcome === "delinquent" ? A1 - provision : A1 - loss.toLenders;
  const before = assetsForShares(mine, S1, A1);
  const after = assetsForShares(mine, S1, A2);
  const diff = after - before;
  const price = (s: bigint, a: bigint) => (Number(sharePrice1e6(s, a)) / 1e6).toFixed(6);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-4">
        <Field
          label="You deposit (USDC)"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          inputMode="decimal"
        />
        <div className="grid grid-cols-3 gap-2">
          <Field
            label="Vault value (NAV)"
            value={nav}
            onChange={(e) => setNav(e.target.value)}
            inputMode="decimal"
          />
          <Field
            label="Total shares"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            inputMode="decimal"
          />
          <Field
            label="Reserve"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <p className="text-xs text-subtle">
          {live ? <Badge tone="good">live from the testnet vault</Badge> : "Example numbers"} Change anything
          to explore.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="A loan of (USDC)"
            value={loan}
            onChange={(e) => setLoan(e.target.value)}
            inputMode="decimal"
          />
          <Field
            label="Its fee (%)"
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">…and then the loan is</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["repaid", "Repaid"],
                ["delinquent", "Late (delinquent)"],
                ["default", "Defaulted"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setOutcome(k)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  outcome === k
                    ? "border-ink-700 bg-ink-700 text-sand-300"
                    : "border-line bg-panel text-ink-700 hover:bg-sand-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl bg-ink-700 p-5 text-sand-100 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-sand-300">Your position</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-sand-100/70">Shares you get</p>
              <p className="font-mono text-2xl font-semibold">{fmtUsdc(mine)}</p>
              <p className="text-xs text-sand-100/70">at price {price(S, A)}</p>
            </div>
            <div>
              <p className="text-xs text-sand-100/70">Worth afterwards</p>
              <p className="font-mono text-2xl font-semibold text-sand-300">{fmtUsdc(after)}</p>
              <p className={`text-xs ${diff >= 0n ? "text-ink-200" : "text-[#f2b8a8]"}`}>
                {diff >= 0n ? "+" : "−"}
                {fmtUsdc(diff >= 0n ? diff : -diff, 6)} USDC · price {price(S1, A2)}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-sand-100/85">
            {outcome === "repaid" &&
              `The ${fmtUsdc(fee)} fee is repaid with the loan: 90% (${fmtUsdc(lenderFee)}) raises the vault value and every share's price; 10% goes to the reserve.`}
            {outcome === "delinquent" &&
              `A late loan sets aside 50% of its unpaid principal (${fmtUsdc(provision)}), so the share price dips until payments catch up. When the loan is current again, the provision is released.`}
            {outcome === "default" &&
              (loss.toLenders === 0n
                ? `The reserve pays the full ${fmtUsdc(L)} unpaid principal, so lenders lose nothing. Later recoveries refill the reserve first.`
                : `The reserve covers ${fmtUsdc(loss.fromReserve)} and lenders absorb ${fmtUsdc(loss.toLenders)}, shared by every share. Your part: ${fmtUsdc(-diff)}.`)}
          </p>
        </div>
        <Explain title="Show the formulas">
          <Row label="Share price = (vault value + 1) ÷ (shares + 1)" value={price(S, A)} />
          <Row
            label={`Shares = ${fmtUsdc(D)} × (${fmtUsdc(S)} + 1) ÷ (${fmtUsdc(A)} + 1)`}
            value={fmtUsdc(mine, 6)}
          />
          <Row
            label="Vault value = cash + loans outstanding − provisions"
            value={`${fmtUsdc(A1)} → ${fmtUsdc(A2)}`}
          />
          <Row label="Your value = your shares × the new price" value={fmtUsdc(after, 6)} strong />
          <p className="text-xs text-subtle">
            The +1 (a virtual offset of 1 USDC) stops anyone from manipulating the price of an almost-empty
            vault. Withdrawals are priced when you claim, after a 120-second wait, so nobody can leave just
            before a loss at the old price.
          </p>
        </Explain>
      </div>
    </div>
  );
}
