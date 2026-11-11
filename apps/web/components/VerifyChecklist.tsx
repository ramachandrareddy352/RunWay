// The live VerifyReport, check by check (BUILD_PLAN T2.2 step 5).
import type { VerifyReport } from "@runway/sdk";

const LABEL: Record<string, string> = {
  signature: "Quote signed by 1Click",
  dry: "Quote type",
  recipient: "Pays the merchant's settlement account",
  destinationAsset: "Delivers USDC on NEAR",
  minAmountOut: "Delivers at least the invoice amount",
  deadline: "Deadline in the future",
  depositAddress: "Deposit address present",
  status: "1Click status re-read matches",
};

export function VerifyChecklist({ report }: { report: VerifyReport | null }) {
  if (!report) return null;
  return (
    <ul className="space-y-1" aria-label="quote verification">
      {report.checks.map((c) => (
        <li
          key={c.id}
          data-check={c.id}
          data-ok={c.skipped ? "skipped" : String(c.ok)}
          className="flex gap-2 text-sm"
        >
          <span aria-hidden className={c.skipped ? "text-subtle" : c.ok ? "text-good" : "text-bad"}>
            {c.skipped ? "–" : c.ok ? "✔" : "✖"}
          </span>
          <span className="font-medium">{LABEL[c.id] ?? c.id}</span>
          <span className="truncate text-subtle">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
