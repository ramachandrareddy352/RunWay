"use client";
// /merchant/settings (BUILD_PLAN T4b.9): payout mode, rupee payout account, ₹ payout history.
import { useMemo } from "react";
import { PayoutSettings, type SettingsDeps } from "../../../components/PayoutSettings";
import { Button, Card } from "../../../components/ui";
import { payoutsFor, registerBeneficiary, setPayoutMode } from "../../../lib/actions";
import { credit } from "../../../lib/chain";
import { useWallet } from "../../../lib/wallet";

export default function SettingsPage() {
  const w = useWallet();
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
    };
  }, [w]);
  if (!deps)
    return (
      <Card title="Settings">
        <Button onClick={w.signIn}>Connect wallet</Button>
      </Card>
    );
  return <PayoutSettings deps={deps} />;
}
