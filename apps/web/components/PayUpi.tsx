"use client";
// UPI checkout through the INR gateway (BUILD_PLAN T4b.9, test W10). Amount in ₹ → POST /inr/collect
// → QR (Razorpay) or the SIMULATED UPI page (mock) → poll until delivered.
import { formatInr, inrToUsdc } from "@runway/fx";
import { useEffect, useState } from "react";
import { fmtUsdc, parseRupees } from "../lib/format";
import { Badge, Button, Card, ErrorText, Field, SimulatedBanner } from "./ui";

export interface CollectBody {
  kind: "merchant_sale" | "lender_deposit" | "repayment";
  handle?: string;
  beneficiary?: string;
  loan_id?: string;
  amount_paise: string;
}

export interface CollectReply {
  collect_id: string;
  provider: string;
  qr_image_url?: string;
  mock_url?: string;
  rate_ppu_estimate: number;
  usdc_estimate: string;
  expires_at: string;
  simulated: boolean;
}

export interface CollectState {
  status: "pending" | "paid" | "delivered" | "failed";
  payment_ref_hash?: string;
  reason?: string;
}

export interface UpiDeps {
  collect(body: CollectBody): Promise<CollectReply>;
  collectStatus(id: string): Promise<CollectState>;
  explorerFor?(paymentRefHash: string): string;
  pollMs?: number;
  /** Live paise-per-USDC rate, for a preview before the QR is created (optional). */
  ratePpu?: number | null;
}

export function useCollect(deps: UpiDeps) {
  const [collect, setCollect] = useState<CollectReply | null>(null);
  const [state, setState] = useState<CollectState | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!collect) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await deps.collectStatus(collect.collect_id);
        if (!stop) setState(s);
        if (s.status === "delivered" || s.status === "failed") stop = true;
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const t = setInterval(() => !stop && tick(), deps.pollMs ?? 3_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [collect, deps]);

  const start = async (body: CollectBody) => {
    setError(null);
    setState(null);
    try {
      setCollect(await deps.collect(body));
    } catch (e) {
      setError(e);
    }
  };
  return { collect, state, error, start };
}

export function CollectView({
  collect,
  state,
  explorerFor,
}: {
  collect: CollectReply;
  state: CollectState | null;
  explorerFor?: (h: string) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((Date.parse(collect.expires_at) - now) / 1000));
  return (
    <div className="space-y-2" data-testid="collect">
      <p className="text-sm">
        Estimated rate ₹{(collect.rate_ppu_estimate / 100).toFixed(2)} per USDC → about{" "}
        <span className="font-mono">{fmtUsdc(collect.usdc_estimate)}</span> USDC. The rate is fixed when the
        payment is confirmed.
      </p>
      {collect.qr_image_url && <img src={collect.qr_image_url} alt="UPI QR code" width={200} height={200} />}
      {collect.mock_url && (
        <a
          className="inline-block rounded-lg border border-warn px-3 py-2 text-sm font-semibold text-warn"
          href={collect.mock_url}
          target="_blank"
          rel="noreferrer"
        >
          Open the SIMULATED UPI page
        </a>
      )}
      <p className="text-xs text-subtle">
        Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </p>
      {state && (
        <p className="text-sm" data-testid="collect-status">
          Status:{" "}
          <Badge tone={state.status === "delivered" ? "good" : state.status === "failed" ? "bad" : "neutral"}>
            {state.status}
          </Badge>
          {state.reason && <span className="ml-2 text-subtle">{state.reason}</span>}
        </p>
      )}
      {state?.status === "delivered" && state.payment_ref_hash && (
        <p className="text-sm">
          Recorded on-chain as receipt{" "}
          <span className="font-mono">{state.payment_ref_hash.slice(0, 10)}…</span>
          {explorerFor && (
            <a
              className="ml-2 text-accent underline"
              href={explorerFor(state.payment_ref_hash)}
              target="_blank"
              rel="noreferrer"
            >
              NEAR transaction
            </a>
          )}
        </p>
      )}
    </div>
  );
}

export function PayUpi({ handle, deps }: { handle: string; deps: UpiDeps }) {
  const [rupees, setRupees] = useState("");
  const paise = parseRupees(rupees);
  const { collect, state, error, start } = useCollect(deps);
  return (
    <Card title={`Pay ${handle} in rupees (UPI)`}>
      <div className="space-y-4">
        <SimulatedBanner>
          Testnet uses a mock UPI provider: you press “Simulate success” instead of paying in a UPI app.
        </SimulatedBanner>
        <Field
          label="Amount (₹)"
          inputMode="decimal"
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          hint={paise ? formatInr(paise) : "e.g. 8500"}
        />
        {!collect && paise && paise > 0n && deps.ratePpu ? (
          <div className="rounded-xl border border-sand-400/70 bg-sand-100 p-3 text-sm">
            At today&apos;s rate (₹{(deps.ratePpu / 100).toFixed(2)} per USDC, minus 0.5%) {handle} receives
            about{" "}
            <span className="font-mono font-semibold">
              {fmtUsdc(inrToUsdc(paise, deps.ratePpu, 50))} USDC
            </span>
            .
            {paise > 10_000_000n && (
              <span className="block text-warn">One UPI payment can be at most ₹1,00,000.</span>
            )}
          </div>
        ) : null}
        <Button
          disabled={!paise || paise <= 0n}
          onClick={() => paise && start({ kind: "merchant_sale", handle, amount_paise: paise.toString() })}
        >
          Get UPI QR
        </Button>
        <ErrorText error={error} />
        {collect && <CollectView collect={collect} state={state} explorerFor={deps.explorerFor} />}
        {collect && (
          <ol className="list-decimal space-y-1 pl-5 text-xs text-subtle">
            <li>Open the SIMULATED UPI page (a real deployment shows a QR for any UPI app).</li>
            <li>Press “Simulate success”. This page updates by itself: pending → paid → delivered.</li>
            <li>Within about 30 seconds the payment is split and reaches the merchant.</li>
          </ol>
        )}
      </div>
    </Card>
  );
}
