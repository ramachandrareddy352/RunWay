"use client";
// /merchant/settings (BUILD_PLAN T4b.9, test W12): payout mode, beneficiary registration (sealed to
// the gateway; only a masked label comes back), and the ₹ payout history.
import { formatInr } from "@runway/fx";
import type { PayoutRequest } from "@runway/sdk";
import { useEffect, useState } from "react";
import { fmtUsdc } from "../lib/format";
import { Badge, Button, Card, ErrorText, Field } from "./ui";

export type BeneficiaryInput =
  | { type: "vpa"; name: string; vpa: string }
  | { type: "bank_account"; name: string; ifsc: string; account_number: string };

export interface SettingsDeps {
  payoutMode(): Promise<"Usdc" | "Inr">;
  setPayoutMode(mode: "Usdc" | "Inr"): Promise<void>;
  registerBeneficiary(b: BeneficiaryInput): Promise<{ masked: string }>;
  history(): Promise<PayoutRequest[]>;
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

  return (
    <div className="space-y-4">
      <Card title="Payout currency">
        <p className="mb-3 text-sm">
          Current: <Badge tone="neutral">{mode ?? "…"}</Badge>{" "}
          {mode === "Inr"
            ? "Your share of each payment is paid out in rupees by the INR gateway."
            : "Your share is sent as USDC on NEAR."}
        </p>
        <Button onClick={toggle} disabled={!mode || busy}>
          Switch to {mode === "Usdc" ? "₹ (INR)" : "USDC"}
        </Button>
      </Card>
      <Card title="Rupee payout account">
        <div className="space-y-3">
          <div className="flex gap-2 text-sm">
            <label>
              <input type="radio" checked={kind === "vpa"} onChange={() => setKind("vpa")} /> UPI
            </label>
            <label>
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
      <Card title="₹ payout history">
        {history.length === 0 ? (
          <p className="text-sm text-subtle">No rupee payouts yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="payout history">
            <thead>
              <tr className="text-left text-subtle">
                <th>#</th>
                <th>Kind</th>
                <th>USDC</th>
                <th>₹</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono">{p.id}</td>
                  <td>{p.kind}</td>
                  <td className="font-mono">{fmtUsdc(p.usdc)}</td>
                  <td className="font-mono">{p.inr_paise ? formatInr(BigInt(p.inr_paise)) : "—"}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ErrorText error={error} />
    </div>
  );
}
