"use client";
// /lend (BUILD_PLAN T5.4, T4b.9): vault stats, USDC deposit, request/claim/cancel withdraw with a
// countdown, and ₹ deposit / ₹ withdrawal through the INR gateway.
import { formatInr, usdcToInr } from "@runway/fx";
import { useEffect, useMemo, useState } from "react";
import { RupeeDeposit, RupeeWithdraw, type LendRupeeDeps } from "../../components/LendRupees";
import { Badge, Button, Card, ErrorText, Field, Stat } from "../../components/ui";
import {
  cancelWithdraw,
  claimWithdraw,
  collect,
  collectStatus,
  depositUsdc,
  payoutsFor,
  requestWithdraw,
  storageDeposit,
} from "../../lib/actions";
import { credit, gateway, storageOf } from "../../lib/chain";
import { DEPLOYMENT, PROFILE } from "../../lib/env";
import { bps, fmtUsdc, parseUsdc } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useWallet } from "../../lib/wallet";

const KEY = (a: string) => `runway:withdraws:${a}`;
const loadIds = (a: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY(a)) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const saveIds = (a: string, ids: string[]) => {
  try {
    localStorage.setItem(KEY(a), JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
};

function Countdown({ readyAt }: { readyAt: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = readyAt - now;
  return left > 0 ? <span>ready in {left}s</span> : <Badge tone="good">ready</Badge>;
}

export default function LendPage() {
  const w = useWallet();
  const account = w.accountId;
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const vault = useAsync(() => credit.vault(), []);
  const mine = useAsync(async () => {
    if (!account) return null;
    const [s, storage] = await Promise.all([credit.shares(account), storageOf(DEPLOYMENT.credit, account)]);
    return { shares: BigInt(s ?? "0"), storage: storage !== null };
  }, [account]);
  const requests = useAsync(
    async () => Promise.all(ids.map((id) => credit.withdrawRequest(id))),
    [ids.join(",")],
  );

  useEffect(() => {
    if (account) setIds(loadIds(account));
  }, [account]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      vault.reload();
      mine.reload();
      requests.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const rupeeDeps = useMemo<LendRupeeDeps>(
    () => ({
      account,
      collect,
      collectStatus,
      hasShareStorage: async (a) => (await storageOf(DEPLOYMENT.credit, a)) !== null,
      registerShareStorage: async () => {
        await storageDeposit(w, DEPLOYMENT.credit, account!);
      },
      shares: async (a) => BigInt((await credit.shares(a)) ?? "0"),
      hasBeneficiary: async (a) => (await gateway.beneficiaryBlob(a)) !== null,
      requestWithdraw: async (s) => {
        const id = await requestWithdraw(w, s, "Inr");
        return id;
      },
      claimWithdraw: async (id) => {
        await claimWithdraw(w, id);
      },
      latestPayout: async (a) => (await payoutsFor(a)).find((p) => p.kind === "lender_withdrawal") ?? null,
    }),
    [account, w],
  );

  const v = vault.data;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Lend</h1>
      {v && (
        <Card title="Vault">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Total assets (NAV)" value={fmtUsdc(v.total_assets)} sub="USDC" />
            <Stat
              label="Share price"
              value={(Number(v.share_price_1e6) / 1e6).toFixed(6)}
              sub={`≈ ${formatInr(usdcToInr(BigInt(v.share_price_1e6), 8_500, 0))} at ₹85 (display only)`}
            />
            <Stat label="Utilization" value={bps(v.utilization_bps)} />
            <Stat label="Outstanding principal" value={fmtUsdc(v.outstanding_principal)} />
            <Stat label="Provisions" value={fmtUsdc(v.provisions)} />
            <Stat label="First-loss reserve" value={fmtUsdc(v.reserve)} />
          </div>
        </Card>
      )}
      {!account ? (
        <Card title="Deposit">
          <Button onClick={w.signIn}>Connect wallet</Button>
        </Card>
      ) : (
        <>
          <Card
            title="Deposit USDC"
            aside={
              mine.data && <span className="font-mono text-sm">{fmtUsdc(mine.data.shares)} runUSDC</span>
            }
          >
            <div className="space-y-3">
              {mine.data && !mine.data.storage ? (
                <Button
                  onClick={() => run(() => storageDeposit(w, DEPLOYMENT.credit, account))}
                  disabled={busy}
                >
                  Register share storage (0.01 NEAR)
                </Button>
              ) : (
                <>
                  <Field label="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <Button
                    disabled={!parseUsdc(amount) || busy}
                    onClick={() => run(() => depositUsdc(w, parseUsdc(amount)!))}
                  >
                    Deposit
                  </Button>
                </>
              )}
            </div>
          </Card>
          <Card title="Withdraw USDC">
            <div className="space-y-3">
              <p className="text-sm">
                Requests wait {PROFILE.time.withdrawCooldownSec}s and are priced when you claim, so losses
                booked meanwhile are shared fairly.
              </p>
              <Field label="Shares (runUSDC)" value={shares} onChange={(e) => setShares(e.target.value)} />
              <Button
                disabled={!parseUsdc(shares) || busy}
                onClick={() =>
                  run(async () => {
                    const id = await requestWithdraw(w, parseUsdc(shares)!, "Usdc");
                    const next = [...new Set([...ids, id])];
                    setIds(next);
                    saveIds(account, next);
                  })
                }
              >
                Request withdrawal
              </Button>
              {(requests.data ?? []).map(
                (r) =>
                  r && (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-mono">#{r.id}</span>
                      <span>{fmtUsdc(r.shares)} shares</span>
                      <Badge>{r.payout}</Badge>
                      <Countdown readyAt={Number(r.ready_at_sec)} />
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => run(() => claimWithdraw(w, r.id))}
                      >
                        Claim
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => run(() => cancelWithdraw(w, r.id))}
                      >
                        Cancel
                      </Button>
                    </div>
                  ),
              )}
            </div>
          </Card>
          <RupeeDeposit deps={rupeeDeps} />
          <RupeeWithdraw deps={rupeeDeps} cooldownSec={PROFILE.time.withdrawCooldownSec} />
        </>
      )}
      <ErrorText error={error ?? vault.error} />
    </div>
  );
}
