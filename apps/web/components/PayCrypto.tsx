"use client";
// Crypto checkout (BUILD_PLAN T2.2, design §9.1). The browser calls 1Click directly.
//   live:    a real quote to the settlement account; the deposit address and QR appear only when
//            every VerifyReport check passes and /v0/status re-confirms it (mainnet; not built under A1).
//   preview: testnet (Amendment A1). 1Click is mainnet-only and refuses testnet recipients, so a dry
//            quote to an existing mainnet account shows live pricing and the checks, and the payment
//            itself is a SIMULATED testnet transfer of mock USDC.
import {
  minimumFor,
  PREVIEW_RECIPIENT,
  quoteRequest,
  USDC_NEAR_ASSET,
  verifyQuote,
  type QuoteInput,
  type StatusName,
  type Token,
  type VerifyReport,
} from "@runway/sdk";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { validRefundAddress } from "../lib/addresses";
import { fmtUsdc } from "../lib/format";
import { StatusTimeline } from "./StatusTimeline";
import { Badge, Button, Card, ErrorText, Field, SimulatedBanner } from "./ui";
import { VerifyChecklist } from "./VerifyChecklist";

export const SUPPORTED_CHAINS = ["base", "arb", "eth", "op", "pol", "sol", "near", "bsc", "tron", "btc"];

export interface PayCryptoDeps {
  tokens(): Promise<Token[]>;
  quote(req: ReturnType<typeof quoteRequest>): Promise<unknown>;
  verify?: typeof verifyQuote;
  /** live only: /v0/status re-read of the deposit address. */
  recheck?(depositAddress: string): Promise<VerifyReport>;
  status(depositAddress: string): Promise<{ status: StatusName }>;
  /** live only: fire-and-forget log to the Runway API. */
  logPayment?(depositAddress: string): Promise<void>;
  /** preview only: SIMULATED testnet payment. */
  simulate?(amount: bigint): Promise<{ depositAddress: string }>;
  pollMs?: number;
}

interface Props {
  handle: string;
  settlement: string;
  amount: bigint;
  mode: "live" | "preview";
  deps: PayCryptoDeps;
}

export function PayCrypto({ handle, settlement, amount, mode, deps }: Props) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [amountIn, setAmountIn] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusName | null>(null);
  const [simulated, setSimulated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    deps
      .tokens()
      .then((t) =>
        setTokens(t.filter((x) => SUPPORTED_CHAINS.includes(x.blockchain) && x.assetId !== USDC_NEAR_ASSET)),
      )
      .catch(setError);
  }, [deps]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const belowMin = (t: Token) => amount < minimumFor(t.blockchain);
  const refundOk = token ? validRefundAddress(token.blockchain, refundTo) : false;

  useEffect(() => {
    if (!depositAddress || mode !== "live") return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await deps.status(depositAddress);
        if (!stop) setStatus(s.status);
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const t = setInterval(tick, deps.pollMs ?? 5_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [depositAddress, deps, mode]);

  async function getQuote() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setDepositAddress(null);
    try {
      const dry = mode === "preview";
      const recipient = dry ? PREVIEW_RECIPIENT : settlement;
      const input: QuoteInput = {
        dry,
        originAsset: token.assetId,
        amountOut: amount,
        recipient,
        refundTo: refundTo.trim(),
      };
      const q = await deps.quote(quoteRequest(input));
      const r = (deps.verify ?? verifyQuote)(q, {
        settlement: recipient,
        usdcAssetId: USDC_NEAR_ASSET,
        minOut: amount,
        now: new Date(),
        dry,
      });
      const quote = (q as { quote?: { depositAddress?: string; amountInFormatted?: string } }).quote;
      setAmountIn(quote?.amountInFormatted ?? null);
      if (!dry && r.ok && quote?.depositAddress) {
        const again = deps.recheck ? await deps.recheck(quote.depositAddress) : r;
        setReport({
          ok: r.ok && again.ok,
          checks: [...r.checks, ...again.checks.filter((c) => c.id === "status")],
        });
        if (again.ok) {
          setDepositAddress(quote.depositAddress);
          void deps.logPayment?.(quote.depositAddress).catch(() => undefined);
        }
      } else setReport(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!deps.simulate) return;
    setBusy(true);
    setError(null);
    try {
      const r = await deps.simulate(amount);
      setSimulated(r.depositAddress);
      setStatus("SUCCESS");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={`Pay ${fmtUsdc(amount)} USDC to ${handle}`}
      aside={mode === "preview" ? <Badge tone="warn">testnet</Badge> : null}
    >
      <div className="space-y-4">
        {mode === "preview" && (
          <SimulatedBanner>
            1Click runs on mainnet only. The quote below is a live <em>price preview</em> (dry quote, no
            deposit address); the payment is mock USDC on testnet.
          </SimulatedBanner>
        )}
        <ol className="grid gap-2 text-xs text-subtle sm:grid-cols-3">
          {[
            ["1", "Choose the token and chain you'll pay from."],
            ["2", "Give an address of yours on that chain, used only if the swap must be refunded."],
            ["3", "Get a live quote. Your browser checks it before you can pay."],
          ].map(([n, t]) => (
            <li key={n} className="flex gap-2 rounded-lg bg-sand-50 p-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] font-bold text-sand-300">
                {n}
              </span>
              {t}
            </li>
          ))}
        </ol>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Pay with</span>
          <select
            aria-label="asset"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="w-full rounded-xl border border-line bg-sand-50 px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:border-ink-500 focus:ring-4 focus:ring-ink-100"
          >
            <option value="">Choose an asset…</option>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId} disabled={belowMin(t)}>
                {t.symbol} on {t.blockchain}
                {belowMin(t) ? ` — minimum $${fmtUsdc(minimumFor(t.blockchain), 0)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Refund address (on the chain you pay from)"
          value={refundTo}
          onChange={(e) => setRefundTo(e.target.value)}
          hint={
            token && refundTo && !refundOk
              ? `Not a valid ${token.blockchain} address`
              : token && ["base", "arb", "eth", "op", "pol", "bsc"].includes(token.blockchain)
                ? "Refunds go here if the swap can't complete. Any 0x… address of yours on that chain."
                : "Refunds go here if the swap can't complete."
          }
        />
        <Button onClick={getQuote} disabled={!token || !refundOk || busy}>
          {busy ? "Working…" : "Get quote"}
        </Button>
        <ErrorText error={error} />
        {report && (
          <div className="space-y-2">
            {amountIn && (
              <p className="text-sm">
                You send about <span className="font-mono">{amountIn}</span> {token?.symbol}.
              </p>
            )}
            <VerifyChecklist report={report} />
          </div>
        )}
        {depositAddress && (
          <div className="space-y-2" data-testid="deposit">
            <p className="text-sm font-medium">Send to this address:</p>
            <QRCodeSVG value={depositAddress} size={160} />
            <p className="break-all font-mono text-sm">{depositAddress}</p>
          </div>
        )}
        {mode === "preview" && report?.ok && !simulated && (
          <Button onClick={simulate} disabled={busy || !deps.simulate}>
            Pay {fmtUsdc(amount)} with SIMULATED testnet USDC
          </Button>
        )}
        {simulated && (
          <p className="text-sm">
            SIMULATED payment <span className="font-mono">{simulated}</span>: mock USDC was sent to{" "}
            <span className="font-mono">{settlement}</span>. The keeper settles it and splits any loan
            repayment.
          </p>
        )}
        {(depositAddress || simulated) && <StatusTimeline status={status} />}
      </div>
    </Card>
  );
}
