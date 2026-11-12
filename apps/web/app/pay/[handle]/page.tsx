"use client";
// /pay/[handle]?amount=<usdc>&memo=<text> (BUILD_PLAN T2.2, T4b.9).
import { getQuote, getStatus, getTokens, type MerchantView } from "@runway/sdk";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PayCrypto, type PayCryptoDeps } from "../../../components/PayCrypto";
import { PayUpi, type UpiDeps } from "../../../components/PayUpi";
import { Button, Card, ErrorText, Field } from "../../../components/ui";
import { collect, collectStatus, logPayment, simulatePayment } from "../../../lib/actions";
import { verified } from "../../../lib/chain";
import { DEPLOYMENT, EXPLORER, NETWORK } from "../../../lib/env";
import { parseUsdc } from "../../../lib/format";

function Pay() {
  const { handle } = useParams<{ handle: string }>();
  const q = useSearchParams();
  const [merchant, setMerchant] = useState<MerchantView | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<"crypto" | "upi">("crypto");
  const [amountText, setAmountText] = useState(q.get("amount") ?? "");
  const amount = parseUsdc(amountText);
  const memo = q.get("memo");

  useEffect(() => {
    verified.credit.merchant(handle).then(setMerchant).catch(setError);
  }, [handle]);

  const cryptoDeps = useMemo<PayCryptoDeps>(
    () => ({
      tokens: () => getTokens(),
      quote: (req) => getQuote(req),
      status: (addr) => getStatus(addr),
      simulate:
        NETWORK === "testnet" || NETWORK === "sandbox" ? (a) => simulatePayment(handle, a) : undefined,
      logPayment: (addr) => logPayment(handle, addr),
    }),
    [handle],
  );
  // The receipt is recorded by the gateway contract; its transactions are listed on its explorer page.
  const upiDeps = useMemo<UpiDeps>(
    () => ({ collect, collectStatus, explorerFor: () => `${EXPLORER}/address/${DEPLOYMENT.inr}` }),
    [],
  );

  if (error) return <ErrorText error={error} />;
  if (merchant === undefined) return <p className="text-sm text-subtle">Looking up {handle} on two RPCs…</p>;
  if (merchant === null)
    return (
      <Card title="Not found">
        <p className="text-sm">There is no Runway merchant called “{handle}”.</p>
      </Card>
    );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Pay {handle}</h1>
        {memo && <p className="text-sm text-subtle">For: {memo}</p>}
        <p className="text-xs text-subtle">
          Settles to <span className="font-mono">{merchant.merchant.settlement}</span> (a keyless account;
          read from two RPCs).
        </p>
      </div>
      {!q.get("amount") && (
        <Field
          label="Amount (USDC)"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
        />
      )}
      <div className="flex gap-2" role="tablist">
        <Button
          role="tab"
          aria-selected={tab === "crypto"}
          variant={tab === "crypto" ? "primary" : "secondary"}
          onClick={() => setTab("crypto")}
        >
          Crypto
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "upi"}
          variant={tab === "upi" ? "primary" : "secondary"}
          onClick={() => setTab("upi")}
        >
          UPI (₹)
        </Button>
      </div>
      {tab === "crypto" ? (
        amount && amount > 0n ? (
          <PayCrypto
            handle={handle}
            settlement={merchant.merchant.settlement}
            amount={amount}
            mode="preview"
            deps={cryptoDeps}
          />
        ) : (
          <p className="text-sm text-subtle">Enter an amount to pay.</p>
        )
      ) : (
        <PayUpi handle={handle} deps={upiDeps} />
      )}
    </div>
  );
}

export default function PayPage() {
  return (
    <Suspense>
      <Pay />
    </Suspense>
  );
}
