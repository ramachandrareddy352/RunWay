"use client";
// ₹ deposit and ₹ withdrawal for lenders (BUILD_PLAN T4b.9 /lend, test W11). Shares are still
// runUSDC: rupees are converted to USDC at the gateway, and back at withdrawal.
import { formatInr, inrToUsdc, usdcToInr } from "@runway/fx";
import type { PayoutRequest } from "@runway/sdk";
import { useCallback, useEffect, useState } from "react";
import { fmtUsdc, parseRupees, parseUsdc } from "../lib/format";
import { assetsForShares, sharesForDeposit } from "../lib/sim";
import { CollectView, useCollect, type UpiDeps } from "./PayUpi";
import { Badge, Button, Card, ErrorText, Field } from "./ui";

export interface LendRupeeDeps extends UpiDeps {
  account: string | null;
  hasShareStorage(account: string): Promise<boolean>;
  registerShareStorage(): Promise<void>;
  shares(account: string): Promise<bigint>;
  hasBeneficiary(account: string): Promise<boolean>;
  /** request_withdraw(shares, Inr) → request id */
  requestWithdraw(shares: bigint): Promise<string>;
  claimWithdraw(requestId: string): Promise<void>;
  /** The newest lender_withdrawal payout for this account. */
  latestPayout(account: string): Promise<PayoutRequest | null>;
  /** For previews (optional): the live rate and the vault's totals. */
  ratePpu?: number | null;
  vault?: { totalShares: bigint; totalAssets: bigint } | null;
}

export function RupeeDeposit({ deps }: { deps: LendRupeeDeps }) {
  const [storage, setStorage] = useState<boolean | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [rupees, setRupees] = useState("");
  const [error, setError] = useState<unknown>(null);
  const { collect, state, error: collectError, start } = useCollect(deps);
  const account = deps.account;

  const refresh = useCallback(async () => {
    if (!account) return;
    setStorage(await deps.hasShareStorage(account));
    setShares(await deps.shares(account));
  }, [account, deps]);
  useEffect(() => {
    refresh().catch(setError);
  }, [refresh]);
  useEffect(() => {
    if (state?.status === "delivered") refresh().catch(setError);
  }, [state?.status, refresh]);

  const paise = parseRupees(rupees);
  if (!account) return <Card title="Deposit ₹">Connect a wallet to deposit.</Card>;
  return (
    <Card
      title="Deposit ₹ (UPI)"
      aside={
        shares !== null && (
          <span className="font-mono text-sm" data-testid="shares">
            {fmtUsdc(shares)} runUSDC
          </span>
        )
      }
    >
      <div className="space-y-3">
        {storage === false ? (
          <div className="space-y-2">
            <p className="text-sm">
              The vault needs a share account for you first (a small NEAR storage deposit).
            </p>
            <Button onClick={() => deps.registerShareStorage().then(refresh).catch(setError)}>
              Register share storage
            </Button>
          </div>
        ) : (
          <>
            <Field
              label="Amount (₹)"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              hint={paise ? formatInr(paise) : "e.g. 8500"}
            />
            {!collect && paise && deps.ratePpu && deps.vault ? (
              <div className="rounded-xl border border-sand-400/70 bg-sand-100 p-3 text-sm">
                ≈ {fmtUsdc(inrToUsdc(paise, deps.ratePpu, 50))} USDC after conversion → about{" "}
                <span className="font-mono font-semibold">
                  {fmtUsdc(
                    sharesForDeposit(
                      inrToUsdc(paise, deps.ratePpu, 50),
                      deps.vault.totalShares,
                      deps.vault.totalAssets,
                    ),
                  )}{" "}
                  runUSDC
                </span>{" "}
                at the current share price.
              </div>
            ) : null}
            <Button
              disabled={!storage || !paise}
              onClick={() =>
                paise &&
                start({ kind: "lender_deposit", beneficiary: account, amount_paise: paise.toString() })
              }
            >
              Get UPI QR
            </Button>
          </>
        )}
        <ErrorText error={error ?? collectError} />
        {collect && <CollectView collect={collect} state={state} />}
      </div>
    </Card>
  );
}

export function RupeeWithdraw({ deps, cooldownSec }: { deps: LendRupeeDeps; cooldownSec: number }) {
  const [beneficiary, setBeneficiary] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [payout, setPayout] = useState<PayoutRequest | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const account = deps.account;

  useEffect(() => {
    if (account) deps.hasBeneficiary(account).then(setBeneficiary).catch(setError);
  }, [account, deps]);
  useEffect(() => {
    if (!claimed || !account) return;
    let stop = false;
    const tick = async () => {
      const p = await deps.latestPayout(account).catch(() => null);
      if (!stop && p) setPayout(p);
      if (p && (p.status === "Paid" || p.status === "Failed")) stop = true;
    };
    void tick();
    const t = setInterval(() => !stop && tick(), deps.pollMs ?? 3_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [claimed, account, deps]);

  const shares = parseUsdc(amount);
  if (!account) return <Card title="Withdraw to ₹">Connect a wallet to withdraw.</Card>;
  return (
    <Card title="Withdraw to ₹ (UPI or bank)">
      <div className="space-y-3">
        {beneficiary === false && (
          <p className="text-sm" role="alert">
            Register a UPI ID or bank account first (Merchant settings → Rupee payouts). Without one the
            payout fails and the USDC is refunded.
          </p>
        )}
        <Field label="Shares (runUSDC)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {shares && deps.ratePpu && deps.vault && requestId === null ? (
          <div className="rounded-xl border border-sand-400/70 bg-sand-100 p-3 text-sm">
            Worth about {fmtUsdc(assetsForShares(shares, deps.vault.totalShares, deps.vault.totalAssets))}{" "}
            USDC today → paid as about{" "}
            <span className="font-mono font-semibold">
              {formatInr(
                usdcToInr(
                  assetsForShares(shares, deps.vault.totalShares, deps.vault.totalAssets),
                  deps.ratePpu,
                  50,
                ),
              )}
            </span>
            . The final amount uses the share price and rate at claim time.
          </div>
        ) : null}
        <Button
          disabled={!beneficiary || !shares || requestId !== null}
          onClick={() => shares && deps.requestWithdraw(shares).then(setRequestId).catch(setError)}
        >
          Request ₹ withdrawal
        </Button>
        {requestId && !claimed && (
          <div className="space-y-2">
            <p className="text-sm">
              Request #{requestId} is in its {cooldownSec}s cooldown; it is priced when you claim.
            </p>
            <Button
              onClick={() =>
                deps
                  .claimWithdraw(requestId)
                  .then(() => setClaimed(true))
                  .catch(setError)
              }
            >
              Claim
            </Button>
          </div>
        )}
        {payout && (
          <p className="text-sm" data-testid="payout">
            Payout #{payout.id}:{" "}
            <Badge tone={payout.status === "Paid" ? "good" : payout.status === "Failed" ? "bad" : "neutral"}>
              {payout.status}
            </Badge>{" "}
            {fmtUsdc(payout.usdc)} USDC{payout.inr_paise && ` → ${formatInr(BigInt(payout.inr_paise))}`}
          </p>
        )}
        <ErrorText error={error} />
      </div>
    </Card>
  );
}
