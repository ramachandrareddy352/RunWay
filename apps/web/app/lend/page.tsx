"use client";
// /lend (BUILD_PLAN T5.4, T4b.9): vault stats, USDC deposit, request/claim/cancel withdraw with a
// countdown, and ₹ deposit / ₹ withdrawal through the INR gateway, with live previews of each action.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RupeeDeposit, RupeeWithdraw, type LendRupeeDeps } from "../../components/LendRupees";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  ErrorText,
  Explain,
  Field,
  PageHeader,
  Preview,
  Row,
  Stat,
} from "../../components/ui";
import {
  cancelWithdraw,
  claimWithdraw,
  collect,
  collectStatus,
  depositUsdc,
  faucet,
  payoutsFor,
  requestWithdraw,
  storageDeposit,
} from "../../lib/actions";
import { credit, gateway, storageOf, tokenBalance } from "../../lib/chain";
import { DEPLOYMENT, PROFILE } from "../../lib/env";
import { bps, fmtUsdc, parseUsdc } from "../../lib/format";
import { useLiveRate } from "../../lib/live";
import { assetsForShares, sharesForDeposit } from "../../lib/sim";
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
  const { ratePpu } = useLiveRate();
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const vault = useAsync(() => credit.vault(), []);
  const mine = useAsync(async () => {
    if (!account) return null;
    const [s, storage, usdcBal, tokenStorage] = await Promise.all([
      credit.shares(account),
      storageOf(DEPLOYMENT.credit, account),
      tokenBalance(account).catch(() => "0"),
      storageOf(DEPLOYMENT.token, account),
    ]);
    return {
      shares: BigInt(s ?? "0"),
      storage: storage !== null,
      usdc: BigInt(usdcBal ?? "0"),
      tokenRegistered: tokenStorage !== null,
    };
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

  const v = vault.data;
  const totals = v ? { totalShares: BigInt(v.total_shares), totalAssets: BigInt(v.total_assets) } : null;

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
      ratePpu,
      vault: totals,
    }),
    [account, w, ratePpu, v?.total_shares, v?.total_assets], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dep = parseUsdc(amount);
  const wd = parseUsdc(shares);
  const myValue =
    mine.data && totals ? assetsForShares(mine.data.shares, totals.totalShares, totals.totalAssets) : 0n;

  return (
    <Container className="py-10">
      <PageHeader eyebrow="Lenders" title="Fund merchants. Earn their loan fees.">
        Deposit USDC (or rupees) into the shared vault and get <strong>runUSDC shares</strong>. Merchants
        repay loans plus a fee from their sales; 90% of every fee raises the share price. Withdraw any time
        after a short wait.
      </PageHeader>
      <div className="space-y-6">
        {v && (
          <Card
            title="Vault"
            description="Live from the credit contract on testnet."
            aside={
              <Link className="text-sm font-semibold text-ink-700 underline" href="/docs/lenders">
                What do these mean?
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Total assets (NAV)"
                value={fmtUsdc(v.total_assets)}
                sub="USDC"
                help="Cash + loans outstanding − provisions. This is what all shares together are worth."
              />
              <Stat
                label="Share price"
                value={(Number(v.share_price_1e6) / 1e6).toFixed(6)}
                sub="USDC per runUSDC"
                help="(vault value + 1) ÷ (shares + 1). Rises as fees are repaid; dips only for late or defaulted loans."
              />
              <Stat
                label="Utilization"
                value={bps(v.utilization_bps)}
                help="Loans outstanding ÷ vault value. Capped at 80% so there's always cash for withdrawals."
              />
              <Stat
                label="Outstanding principal"
                value={fmtUsdc(v.outstanding_principal)}
                help="USDC currently lent to merchants."
              />
              <Stat
                label="Provisions"
                value={fmtUsdc(v.provisions)}
                help="Set aside for late loans: 50% of their unpaid principal. Released when they catch up."
              />
              <Stat
                label="First-loss reserve"
                value={fmtUsdc(v.reserve)}
                help="Protocol money that pays defaults before lenders lose anything. Gets 10% of every fee."
              />
            </div>
          </Card>
        )}
        {!account ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Deposit">
              <p className="mb-4 text-sm text-subtle">
                Connect a testnet wallet to deposit. Test USDC is free here.
              </p>
              <Button onClick={w.signIn}>Connect wallet</Button>
            </Card>
            <Callout tone="tip" title="How lending works, in three lines">
              1. Get free test USDC and deposit it: you receive shares at today&apos;s price.
              <br />
              2. Merchants borrow from the vault and repay with a fee, which raises the share price.
              <br />
              3. Request a withdrawal, wait {PROFILE.time.withdrawCooldownSec} seconds, claim your
              shares&apos; value.
            </Callout>
          </div>
        ) : (
          <>
            {mine.data && totals && (
              <div className="grid gap-3 rounded-2xl bg-ink-700 p-5 text-sand-100 shadow-lg sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-sand-300">Your shares</p>
                  <p className="font-mono text-2xl font-semibold">{fmtUsdc(mine.data.shares)} runUSDC</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-sand-300">Worth now</p>
                  <p className="font-mono text-2xl font-semibold text-sand-300">{fmtUsdc(myValue)} USDC</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-sand-300">Wallet</p>
                  <p className="font-mono text-2xl font-semibold">{fmtUsdc(mine.data.usdc)} USDC</p>
                </div>
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card
                title="Deposit USDC"
                description="Step 1: get test USDC. Step 2: register share storage once. Step 3: deposit."
                aside={
                  mine.data && <span className="font-mono text-sm">{fmtUsdc(mine.data.shares)} runUSDC</span>
                }
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      Wallet: <span className="font-mono">{fmtUsdc(mine.data?.usdc ?? 0n)}</span> mock USDC
                    </span>
                    <Button variant="sand" disabled={busy} onClick={() => run(() => faucet(account))}>
                      Get 1,000 test USDC
                    </Button>
                  </div>
                  {mine.data && !mine.data.tokenRegistered && (
                    <p className="text-xs text-warn">
                      Your wallet isn&apos;t registered with USDC yet. The button above registers it and sends
                      1,000 test USDC (free, once every 10 minutes).
                    </p>
                  )}
                  {mine.data && !mine.data.storage ? (
                    <Button
                      onClick={() => run(() => storageDeposit(w, DEPLOYMENT.credit, account))}
                      disabled={busy}
                    >
                      Register share storage (0.01 NEAR)
                    </Button>
                  ) : (
                    <>
                      <Field
                        label="Amount (USDC)"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <Button
                        disabled={!parseUsdc(amount) || busy}
                        onClick={() => run(() => depositUsdc(w, parseUsdc(amount)!))}
                      >
                        Deposit
                      </Button>
                      {dep && totals && (
                        <Preview>
                          <Row label="You deposit" value={`${fmtUsdc(dep)} USDC`} />
                          <Row
                            label="You receive"
                            value={`${fmtUsdc(sharesForDeposit(dep, totals.totalShares, totals.totalAssets))} runUSDC`}
                            strong
                          />
                          <Row label="At share price" value={(Number(v!.share_price_1e6) / 1e6).toFixed(6)} />
                          {mine.data && dep > mine.data.usdc && (
                            <p className="text-xs text-warn">
                              That&apos;s more than your wallet holds. Get test USDC first.
                            </p>
                          )}
                        </Preview>
                      )}
                    </>
                  )}
                </div>
              </Card>
              <Card title="Withdraw USDC" description="Two steps: request, then claim after the cooldown.">
                <div className="space-y-4">
                  <p className="text-sm">
                    Requests wait {PROFILE.time.withdrawCooldownSec}s and are priced when you claim, so losses
                    booked meanwhile are shared fairly.
                  </p>
                  <Field
                    label="Shares (runUSDC)"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                  />
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
                  {wd && totals && (
                    <Preview>
                      <Row
                        label="These shares are worth"
                        value={`${fmtUsdc(assetsForShares(wd, totals.totalShares, totals.totalAssets))} USDC`}
                        strong
                      />
                      <Row
                        label="Ready to claim after"
                        value={`${PROFILE.time.withdrawCooldownSec} seconds`}
                      />
                      {mine.data && wd > mine.data.shares && (
                        <p className="text-xs text-warn">You hold {fmtUsdc(mine.data.shares)} shares.</p>
                      )}
                    </Preview>
                  )}
                  {(requests.data ?? []).map(
                    (r) =>
                      r && (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-sand-50 p-3 text-sm"
                        >
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
                            variant="ghost"
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
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <RupeeDeposit deps={rupeeDeps} />
              <RupeeWithdraw deps={rupeeDeps} cooldownSec={PROFILE.time.withdrawCooldownSec} />
            </div>
            <Explain title="Where do the returns come from, and what are the risks?">
              <p>
                Every loan has a flat fee (4–10%). As the merchant repays, 90% of the fee goes into the vault,
                raising the share price for every lender, and 10% goes to the first-loss reserve.
              </p>
              <p>
                If a loan misses a period, half its unpaid principal is set aside (provisions), so the price
                dips until it catches up. If it defaults, the reserve pays first; lenders lose only what the
                reserve can&apos;t cover. Try each case in the{" "}
                <Link className="font-semibold underline" href="/simulator#lend">
                  lender simulator
                </Link>
                .
              </p>
            </Explain>
          </>
        )}
        <ErrorText error={error ?? vault.error} />
      </div>
    </Container>
  );
}
