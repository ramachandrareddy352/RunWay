"use client";
// /simulator: every calculation the protocol makes, live, with the formulas shown.
import { useEffect, useState } from "react";
import { Icon } from "../../components/art";
import { InrSim } from "../../components/sim/InrSim";
import { LenderSim } from "../../components/sim/LenderSim";
import { OfferSim } from "../../components/sim/OfferSim";
import { RepaySim } from "../../components/sim/RepaySim";
import { Card, Container, PageHeader } from "../../components/ui";

const TABS = [
  {
    id: "offer",
    label: "Will I get a loan?",
    icon: "chart",
    title: "Offer simulator",
    text: "Type a merchant's revenue for each 5-minute window. You get the exact score, grade, limit, fee and repay share the underwriter would compute.",
  },
  {
    id: "repay",
    label: "How is it repaid?",
    icon: "coins",
    title: "Repayment simulator",
    text: "Pick a loan and a list of sales. Each sale is split like the settlement account and the credit contract split it, down to the last millionth of a USDC.",
  },
  {
    id: "lend",
    label: "What do lenders earn?",
    icon: "vault",
    title: "Lender simulator",
    text: "Deposit into the vault, then see your shares and their value when a loan is repaid, is late, or defaults.",
  },
  {
    id: "inr",
    label: "Rupees ⇄ USDC",
    icon: "rupee",
    title: "Rupee converter",
    text: "The INR gateway's exact conversion at the live rate, and where the rupees and USDC actually sit.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SimulatorPage() {
  const [tab, setTab] = useState<TabId>("offer");
  useEffect(() => {
    const h = window.location.hash.slice(1) as TabId;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  const pick = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };
  const t = TABS.find((x) => x.id === tab)!;
  return (
    <Container className="py-10">
      <PageHeader eyebrow="Simulator" title="See the numbers before you act">
        Every number Runway produces comes from a formula you can try here. Nothing on this page touches the
        chain or your wallet: change any input and the results update instantly.
      </PageHeader>
      <div className="mb-6 grid gap-2 sm:grid-cols-4" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => pick(x.id)}
            className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3.5 text-left text-sm font-semibold transition ${
              tab === x.id
                ? "border-ink-700 bg-ink-700 text-sand-300 shadow-lg"
                : "border-line bg-panel text-ink-800 hover:border-sand-400 hover:bg-sand-100"
            }`}
          >
            <Icon name={x.icon} className="h-5 w-5 shrink-0" />
            {x.label}
          </button>
        ))}
      </div>
      <Card title={t.title} description={t.text} className="animate-fade-up" key={tab}>
        {tab === "offer" && <OfferSim />}
        {tab === "repay" && <RepaySim />}
        {tab === "lend" && <LenderSim />}
        {tab === "inr" && <InrSim />}
      </Card>
    </Container>
  );
}
