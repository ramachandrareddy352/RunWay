"use client";
// Live protocol numbers from testnet, for the home page.
import { credit, gateway } from "../lib/chain";
import { useAsync } from "../lib/useAsync";
import { AnimatedNumber } from "./motion";
import { InfoTip } from "./ui";

const usd = (micro: string | undefined) => (micro ? Number(BigInt(micro) / 10_000n) / 100 : 0);

export function LiveStats() {
  const v = useAsync(() => credit.vault(), []);
  const f = useAsync(() => gateway.float(), []);
  // Each number waits for its own read; a failed read shows "—" instead of a misleading 0.
  const vs = { ready: !!v.data, failed: !v.data && !!v.error };
  const fs = { ready: !!f.data, failed: !f.data && !!f.error };
  const items: [string, number, number, string, string, { ready: boolean; failed: boolean }][] = [
    [
      "Lenders' vault",
      usd(v.data?.total_assets),
      2,
      "USDC",
      "Cash plus loans outstanding, minus provisions for late loans. Owned by lenders through runUSDC shares.",
      vs,
    ],
    [
      "Share price",
      v.data ? Number(v.data.share_price_1e6) / 1e6 : 0,
      6,
      "USDC per share",
      "Starts at 1.000000 and rises as loan fees are repaid. Falls only if a default is bigger than the reserve.",
      vs,
    ],
    [
      "Loans active",
      v.data?.active_loans ?? 0,
      0,
      "right now",
      "Loans currently being repaid from merchants' sales.",
      vs,
    ],
    [
      "Rupee float",
      usd(f.data?.free),
      2,
      "USDC",
      "USDC held by the INR gateway to pay out when someone pays in rupees by UPI.",
      fs,
    ],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-[0_20px_50px_-30px_rgba(23,42,44,0.55)] lg:grid-cols-4">
      {items.map(([label, value, decimals, unit, help, st]) => (
        <div key={label} className="bg-panel p-5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sand-700">
            {label} <InfoTip>{help}</InfoTip>
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-ink-900 sm:text-3xl">
            {st.ready ? (
              <AnimatedNumber value={value} decimals={decimals} />
            ) : st.failed ? (
              <span className="text-ink-300">—</span>
            ) : (
              <span className="animate-pulse-soft text-ink-300">…</span>
            )}
          </div>
          <div className="text-xs text-subtle">{unit} · live on testnet</div>
        </div>
      ))}
    </div>
  );
}
