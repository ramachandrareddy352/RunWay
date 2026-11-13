"use client";
// /merchant/settings (BUILD_PLAN T4b.9, test W12): payout mode, beneficiary registration (sealed to
// the gateway; only a masked label comes back), and the ₹ payout history.
import { formatInr, usdcToInr } from "@runway/fx";
import type { PayoutRequest } from "@runway/sdk";
import { useEffect, useState } from "react";
import { fmtUsdc } from "../lib/format";
import { Badge, Button, Callout, Card, ErrorText, Field, Preview, Row } from "./ui";

export type BeneficiaryInput =
  | { type: "vpa"; name: string; vpa: string }
  | { type: "bank_account"; name: string; ifsc: string; account_number: string };

export interface SettingsDeps {
  payoutMode(): Promise<"Usdc" | "Inr">;
  setPayoutMode(mode: "Usdc" | "Inr"): Promise<void>;
  registerBeneficiary(b: BeneficiaryInput): Promise<{ masked: string }>;
  history(): Promise<PayoutRequest[]>;
  /** Live paise-per-USDC rate, for the conversion preview (optional). */
  ratePpu?: number | null;
}

const VPA = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function PayoutSettings({ deps }: { deps: SettingsDeps }) {
  const [mode, setMode] = useState<"Usdc" | "Inr" | null>(null);
  const [kind, setKind] = useState<"vpa" | "bank_account">("vpa");
  const [name, setName] = useState("");
  const [vpa, setVpa] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [acct, setAcct] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [history, setHistory] = useState<PayoutRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    deps.payoutMode().then(setMode).catch(setError);
    deps.history().then(setHistory).catch(setError);
  }, [deps]);

  const valid =
    name.trim().length >= 2 && (kind === "vpa" ? VPA.test(vpa) : IFSC.test(ifsc) && /^\d{9,18}$/.test(acct));

  async function toggle() {
    if (!mode) return;
    const next = mode === "Usdc" ? "Inr" : "Usdc";
    setBusy(true);
    try {
      await deps.setPayoutMode(next);
      setMode(await deps.payoutMode());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const r = await deps.registerBeneficiary(
        kind === "vpa"
          ? { type: "vpa", name: name.trim(), vpa: vpa.trim() }
          : { type: "bank_account", name: name.trim(), ifsc, account_number: acct },
      );
      setMasked(r.masked);
      setVpa("");
      setAcct("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rate = deps.ratePpu ?? null;
  const vpaHint =
    kind === "vpa" && vpa && !VPA.test(vpa)
      ? "A UPI ID looks like name@bank, for example ramatest@okaxis"
      : undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Rupee payout account"
          description="Step 1: where rupee payouts should go. Do this before switching to ₹."
        >
          <div className="space-y-4">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={kind === "vpa"} onChange={() => setKind("vpa")} /> UPI
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={kind === "bank_account"}
                  onChange={() => setKind("bank_account")}
                />{" "}
                Bank account
              </label>
            </div>
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            {kind === "vpa" ? (
              <Field
                label="UPI ID"
                placeholder="name@bank"
                value={vpa}
                onChange={(e) => setVpa(e.target.value)}
              />
            ) : (
              <>
                <Field label="IFSC" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
                <Field label="Account number" value={acct} onChange={(e) => setAcct(e.target.value)} />
              </>
            )}
            {vpaHint && <p className="text-xs text-warn">{vpaHint}</p>}
            <p className="text-xs text-subtle">
              Encrypted in your browser to the attested INR gateway. Only a masked label is stored on-chain,
              inside an encrypted blob.
            </p>
            <Button onClick={register} disabled={!valid || busy}>
              Register
            </Button>
            {masked && (
              <p className="text-sm" data-testid="masked">
                Registered: <span className="font-mono">{masked}</span>
              </p>
            )}
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="Payout currency" description="Step 2: how your share of each payment reaches you.">
            <p className="mb-4 text-sm">
              Current: <Badge tone="ink">{mode ?? "…"}</Badge>{" "}
              {mode === "Inr"
                ? "Your share of each payment is paid out in rupees by the INR gateway."
                : "Your share is sent as USDC on NEAR."}
            </p>
            <Button onClick={toggle} disabled={!mode || busy}>
              Switch to {mode === "Usdc" ? "₹ (INR)" : "USDC"}
            </Button>
            <p className="mt-3 text-xs text-subtle">
              In ₹ mode a new loan is also paid out in rupees. You can switch back at any time; it applies to
              the next payment.
            </p>
          </Card>
          {rate !== null && (
            <Preview title="In rupees, at today's rate">
              <Row label={`Rate (₹ per USDC)`} value={`₹${(rate / 100).toFixed(2)}`} />
              <Row label="A 100 USDC share arrives as" value={formatInr(usdcToInr(100_000_000n, rate, 50))} />
              <Row label="A 400 USDC share arrives as" value={formatInr(usdcToInr(400_000_000n, rate, 50))} />
              <p className="pt-1 text-xs text-subtle">
                ₹ = USDC × rate × 99.5%. The gateway keeps 0.5% and records the rate and a bank-reference hash
                on-chain.
              </p>
            </Preview>
          )}
        </div>
      </div>
      <Card title="₹ payout history" description="Every rupee payout to this wallet, with its status.">
        {history.length === 0 ? (
          <p className="text-sm text-subtle">No rupee payouts yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="payout history">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-subtle">
                <th className="py-2">#</th>
                <th>Kind</th>
                <th>USDC</th>
                <th>₹</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-2 font-mono">{p.id}</td>
                  <td>{p.kind}</td>
                  <td className="font-mono">{fmtUsdc(p.usdc)}</td>
                  <td className="font-mono">{p.inr_paise ? formatInr(BigInt(p.inr_paise)) : "—"}</td>
                  <td>
                    <Badge tone={p.status === "Paid" ? "good" : p.status === "Failed" ? "bad" : "neutral"}>
                      {p.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {mode === "Inr" && !masked && (
        <Callout tone="warn">
          Payouts are in ₹. Make sure a UPI ID or bank account is registered (step 1): a rupee payout to an
          account without one fails and is refunded to you in USDC.
        </Callout>
      )}
      <ErrorText error={error} />
    </div>
  );
}
