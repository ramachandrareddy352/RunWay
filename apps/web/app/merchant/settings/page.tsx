"use client";
// /merchant/settings (BUILD_PLAN T4b.9): payout mode, rupee payout account, ₹ payout history.
import { useMemo } from "react";
import { PayoutSettings, type SettingsDeps } from "../../../components/PayoutSettings";
import { Button, Card, Container, PageHeader } from "../../../components/ui";
import { payoutsFor, registerBeneficiary, setPayoutMode } from "../../../lib/actions";
import { credit } from "../../../lib/chain";
import { useLiveRate } from "../../../lib/live";
import { useWallet } from "../../../lib/wallet";

export default function SettingsPage() {
  const w = useWallet();
  const { ratePpu } = useLiveRate();
  const deps = useMemo<SettingsDeps | null>(() => {
    const account = w.accountId;
    if (!account) return null;
    return {
      payoutMode: async () => (await credit.merchantByAccount(account))?.merchant.payout_mode ?? "Usdc",
      setPayoutMode: async (mode) => {
        await setPayoutMode(w, mode);
      },
      registerBeneficiary: (b) => registerBeneficiary(w, b),
      history: () => payoutsFor(account),
      ratePpu,
    };
  }, [w, ratePpu]);
  return (
    <Container className="py-10">
      <PageHeader eyebrow="Payout settings" title="Get paid in USDC or in rupees">
        Choose how your money reaches you. Rupee payouts go to a UPI ID or bank account you register here;
        lenders use the same account for rupee withdrawals.
      </PageHeader>
      {deps ? (
        <PayoutSettings deps={deps} />
      ) : (
        <Card title="Settings">
          <p className="mb-4 text-sm text-subtle">Connect your wallet to manage payouts.</p>
          <Button onClick={w.signIn}>Connect wallet</Button>
        </Card>
      )}
    </Container>
  );
}
