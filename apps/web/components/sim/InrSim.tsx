"use client";
// Rupee converter: the INR gateway's exact formulas, at the live oracle rate (editable).
import { formatInr, inrToUsdc, usdcToInr } from "@runway/fx";
import { useEffect, useState } from "react";
import { fmtUsdc, parseRupees } from "../../lib/format";
import { FALLBACK_RATE_PPU, useLiveRate } from "../../lib/live";
import { microOf } from "../../lib/sim";
import { Badge, Explain, Field, Row } from "../ui";

const SPREAD_BPS = 50;

export function InrSim() {
  const live = useLiveRate();
  const [dir, setDir] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("10000");
  const [rate, setRate] = useState((FALLBACK_RATE_PPU / 100).toFixed(2));
  const [fromLive, setFromLive] = useState(false);
  useEffect(() => {
    if (live.ratePpu && !fromLive) {
      setRate((live.ratePpu / 100).toFixed(2));
      setFromLive(true);
    }
  }, [live.ratePpu, fromLive]);

  const typed = Math.round(Number(rate) * 100);
  const ratePpu = Number.isSafeInteger(typed) && typed > 0 ? typed : FALLBACK_RATE_PPU;
  const paise = dir === "in" ? (parseRupees(amount) ?? 0n) : 0n;
  const usdcIn = dir === "out" ? (microOf(amount) ?? 0n) : 0n;
  const usdc = dir === "in" ? inrToUsdc(paise, ratePpu, SPREAD_BPS) : usdcIn;
  const outPaise = dir === "out" ? usdcToInr(usdcIn, ratePpu, SPREAD_BPS) : 0n;
  const midUsdc = dir === "in" ? inrToUsdc(paise, ratePpu, 0) : 0n;
  const midPaise = dir === "out" ? usdcToInr(usdcIn, ratePpu, 0) : 0n;
  const back = dir === "in" ? usdcToInr(usdc, ratePpu, SPREAD_BPS) : 0n;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["in", "₹ → USDC (UPI payment in)"],
              ["out", "USDC → ₹ (rupee payout)"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setDir(k);
                setAmount(k === "in" ? "10000" : "100");
              }}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                dir === k
                  ? "border-ink-700 bg-ink-700 text-sand-300"
                  : "border-line bg-panel text-ink-700 hover:bg-sand-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field
          label={dir === "in" ? "Rupees paid (₹)" : "USDC to pay out"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <Field
          label="Rate (₹ per 1 USDC)"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
        />
        <p className="text-xs text-subtle">
          {fromLive ? (
            <>
              <Badge tone="good">live</Badge> median of {live.sources.join(" and ") || "Indian exchange"}{" "}
              prices, from the gateway's oracle.
            </>
          ) : (
            "An example rate (the live oracle couldn't be reached)."
          )}{" "}
          The contract refuses any rate outside ₹70–₹130.
        </p>
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl bg-ink-700 p-5 text-sand-100 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-sand-300">The gateway delivers</p>
          <p className="mt-2 font-mono text-4xl font-semibold text-sand-300">
            {dir === "in" ? `${fmtUsdc(usdc, 6)} USDC` : formatInr(outPaise)}
          </p>
          <p className="mt-2 text-sm text-sand-100/80">
            {dir === "in"
              ? `At the plain rate this would be ${fmtUsdc(midUsdc, 6)} USDC. The gateway keeps 0.5% (${fmtUsdc(midUsdc - usdc, 6)} USDC worth) for converting.`
              : `At the plain rate this would be ${formatInr(midPaise)}. The gateway keeps 0.5% (${formatInr(midPaise - outPaise)}) for converting.`}
          </p>
          {dir === "in" && (
            <p className="mt-2 text-xs text-sand-100/70">
              Converted straight back to rupees it would be {formatInr(back)}: a full round trip costs about
              1%.
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5 text-sm leading-relaxed">
          <p className="mb-2 font-semibold text-ink-900">Where the money actually goes</p>
          {dir === "in" ? (
            <p>
              The rupees land in Runway&apos;s payment-provider account (the <strong>INR treasury</strong>,
              off-chain). The gateway contract then sends {fmtUsdc(usdc)} USDC from its{" "}
              <strong>USDC float</strong> (on-chain) to the merchant&apos;s settlement account, or into the
              vault for a lender. No rupee ever touches the chain.
            </p>
          ) : (
            <p>
              The USDC goes into the gateway&apos;s float (on-chain) and the gateway pays{" "}
              {formatInr(outPaise)} out of the INR treasury to the registered UPI ID or bank account. It
              records the rate and a hash of the bank reference (UTR) on-chain.
            </p>
          )}
        </div>
        <Explain title="Show the formula">
          {dir === "in" ? (
            <Row
              label={`USDC = floor(paise × 1,000,000 × (10,000 − 50) ÷ (${ratePpu} × 10,000))`}
              value={fmtUsdc(usdc, 6)}
            />
          ) : (
            <Row
              label={`paise = floor(USDC × ${ratePpu} × (10,000 − 50) ÷ (1,000,000 × 10,000))`}
              value={formatInr(outPaise)}
            />
          )}
          <p className="text-xs text-subtle">
            Rates are in paise per USDC ({ratePpu} = ₹{(ratePpu / 100).toFixed(2)}), USDC in millionths. The
            contract and the gateway use the same integers, so both always agree.
          </p>
        </Explain>
      </div>
    </div>
  );
}
