// The seven 1Click statuses as a timeline (BUILD_PLAN T2.2 step 6, test W2).
import { STATUSES, type StatusName } from "@runway/sdk";

const LABEL: Record<StatusName, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen on the origin chain",
  INCOMPLETE_DEPOSIT: "Deposit below the quoted amount",
  PROCESSING: "Swapping to USDC on NEAR",
  SUCCESS: "Delivered to the merchant's settlement account",
  REFUNDED: "Refunded to your refund address",
  FAILED: "Failed",
};

const HAPPY: StatusName[] = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];

export function StatusTimeline({ status, explorerUrl }: { status: StatusName | null; explorerUrl?: string }) {
  const reached = status ? HAPPY.indexOf(status) : -1;
  return (
    <div>
      <ol className="space-y-1.5" aria-label="payment status">
        {STATUSES.map((s) => {
          const current = s === status;
          const done = reached >= 0 && HAPPY.indexOf(s) >= 0 && HAPPY.indexOf(s) < reached;
          const mark = current ? "●" : done ? "✔" : "○";
          return (
            <li
              key={s}
              data-status={s}
              data-state={current ? "current" : done ? "done" : "pending"}
              className={`flex gap-2 text-sm ${current ? "font-semibold" : "text-subtle"}`}
            >
              <span aria-hidden>{mark}</span>
              <span className="font-mono text-xs">{s}</span>
              <span>{LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
      {status === "REFUNDED" && (
        <p className="mt-2 text-sm">Your funds went back to the refund address you entered.</p>
      )}
      {status === "INCOMPLETE_DEPOSIT" && (
        <p className="mt-2 text-sm">
          Send the rest of the quoted amount, or wait for the automatic refund to your refund address.
        </p>
      )}
      {status === "FAILED" && (
        <p className="mt-2 text-sm text-bad">The swap failed; 1Click refunds to your refund address.</p>
      )}
      {explorerUrl && (
        <a
          className="mt-2 inline-block text-sm text-accent underline"
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          View on explorer
        </a>
      )}
    </div>
  );
}
