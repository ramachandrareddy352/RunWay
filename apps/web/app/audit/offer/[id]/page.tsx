"use client";
// /audit/offer/[id] (BUILD_PLAN T5.5): the offer's fields, the contract's hard bounds re-evaluated
// in the browser, the agent's measurements and role, the anchor flag, the commitment (checkable
// against sealed inputs), the LLM receipt hash, and the settlement account's code hash and keys.
import { accessKeyCount, verifyCommitment, viewAccount } from "@runway/sdk";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  ErrorText,
  PageHeader,
  Stat,
} from "../../../../components/ui";
import { verified, verifiedView } from "../../../../lib/chain";
import { DEPLOYMENT, RPCS } from "../../../../lib/env";
import { bps, fmtUsdc } from "../../../../lib/format";
import { useAsync } from "../../../../lib/useAsync";

interface Policy {
  anchored_caps: string[];
  unanchored_caps: string[];
  min_loan: string;
  fee_bps_min: number;
  fee_bps_max: number;
  repay_bps_min: number;
  repay_bps_max: number;
  max_exposure_per_merchant: string;
  version: number;
}

const Check = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
  <li className="flex gap-3 rounded-xl bg-sand-50 p-3 text-sm" data-ok={String(ok)}>
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        ok ? "bg-good text-white" : "bg-bad text-white"
      }`}
    >
      {ok ? "✔" : "✖"}
    </span>
    <span className="min-w-0">
      <span className="block font-semibold text-ink-900">{label}</span>
      <span className="block break-all text-xs text-subtle">{detail}</span>
    </span>
  </li>
);

export default function OfferAudit() {
  const { id } = useParams<{ id: string }>();
  const [sealed, setSealed] = useState("");
  const [commitOk, setCommitOk] = useState<boolean | null>(null);
  const d = useAsync(async () => {
    const offer = await verified.credit.offer(id);
    if (!offer) return null;
    const [policy, approved, agent, merchant, factoryHash] = await Promise.all([
      verified.credit.policy() as Promise<unknown> as Promise<Policy>,
      verified.credit.approved(),
      verified.credit.agent(offer.agent),
      verified.credit.merchant(offer.handle),
      verifiedView(DEPLOYMENT.factory, "get_settlement_code_hash", {}) as Promise<string>,
    ]);
    const settlement = merchant?.merchant.settlement;
    const [acct, keys] = settlement
      ? await Promise.all([
          viewAccount(settlement, { rpcs: RPCS }),
          accessKeyCount(settlement, { rpcs: RPCS }),
        ])
      : [null, null];
    return { offer, policy, approved, agent, merchant, factoryHash, acct, keys };
  }, [id]);

  if (d.error)
    return (
      <Container className="py-10">
        <ErrorText error={d.error} />
      </Container>
    );
  if (!d.data)
    return (
      <Container className="py-10">
        <p className="animate-pulse-soft text-sm text-subtle">
          {d.loading ? "Reading the offer from two RPCs…" : `No offer #${id}.`}
        </p>
      </Container>
    );
  const { offer, policy, approved, agent, merchant, factoryHash, acct, keys } = d.data;
  const repaid = Math.min(merchant?.record.loans_repaid ?? 0, 3);
  const caps = offer.anchor_hash ? policy.anchored_caps : policy.unanchored_caps;
  const cap = BigInt(caps[repaid] ?? "0");
  const limit = BigInt(offer.limit);
  const role =
    approved.measurements.find((m) => m.measurements_hash === offer.measurements_hash)?.role ?? null;

  return (
    <Container className="py-10">
      <PageHeader
        eyebrow="Audit · offer"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Offer #{offer.id} for {offer.handle} <Badge tone="ink">{offer.status}</Badge>
          </span>
        }
      >
        Everything below is read from the chain by your browser (two RPCs must agree) and re-checked here. A ✔
        means the check passed with the numbers shown.
      </PageHeader>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Terms" description="What the underwriter offered.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Grade" value={offer.grade} />
            <Stat label="Limit" value={fmtUsdc(offer.limit)} />
            <Stat label="Fee" value={bps(offer.fee_bps)} />
            <Stat label="Repay share" value={bps(offer.repay_bps)} />
          </div>
        </Card>
        <Card
          title="Contract bounds, re-checked here"
          description="The contract refuses any offer outside its policy; your browser repeats the checks."
        >
          <ul className="space-y-2">
            <Check
              ok={limit >= BigInt(policy.min_loan)}
              label="Limit ≥ minimum loan"
              detail={fmtUsdc(policy.min_loan)}
            />
            <Check
              ok={limit <= cap}
              label={`Limit ≤ ${offer.anchor_hash ? "anchored" : "unanchored"} tier cap`}
              detail={`${fmtUsdc(cap)} at ${repaid} repaid loan(s) (today's record)`}
            />
            <Check
              ok={limit <= BigInt(policy.max_exposure_per_merchant)}
              label="Limit ≤ max exposure"
              detail={fmtUsdc(policy.max_exposure_per_merchant)}
            />
            <Check
              ok={offer.fee_bps >= policy.fee_bps_min && offer.fee_bps <= policy.fee_bps_max}
              label="Fee within policy"
              detail={`${bps(policy.fee_bps_min)}–${bps(policy.fee_bps_max)}`}
            />
            <Check
              ok={offer.repay_bps >= policy.repay_bps_min && offer.repay_bps <= policy.repay_bps_max}
              label="Repay share within policy"
              detail={`${bps(policy.repay_bps_min)}–${bps(policy.repay_bps_max)}`}
            />
            <Check
              ok={offer.policy_version === policy.version}
              label="Policy version current"
              detail={`v${offer.policy_version}`}
            />
          </ul>
        </Card>
        <Card
          title="Who made it"
          description="An approved agent image, with the Underwriter role, registered right now."
        >
          <ul className="space-y-2">
            <Check
              ok={role === "Underwriter"}
              label="Agent image approved with role Underwriter"
              detail={offer.measurements_hash.slice(0, 16)}
            />
            <Check ok={agent?.valid === true} label="Agent registration valid now" detail={offer.agent} />
            <Check
              ok={approved.requires_tee}
              label="Contract requires a TEE"
              detail={approved.requires_tee ? "yes" : "no: local mode (testnet, Amendment A1)"}
            />
          </ul>
        </Card>
        <Card
          title="Evidence"
          description="What the offer was based on, committed on-chain without revealing it."
        >
          <ul className="space-y-1 text-sm">
            <li>
              Identity anchor:{" "}
              {offer.anchor_hash ? (
                <span className="font-mono">{offer.anchor_hash}</span>
              ) : (
                "none (unanchored caps apply)"
              )}
            </li>
            <li>
              Inputs commitment: <span className="font-mono">{offer.inputs_commitment}</span>
            </li>
            <li>
              LLM receipt hash:{" "}
              {offer.llm_receipt_hash ? (
                <span className="font-mono">{offer.llm_receipt_hash}</span>
              ) : (
                "none (no statements)"
              )}
            </li>
          </ul>
          <div className="mt-3 space-y-2">
            <textarea
              aria-label="sealed inputs"
              className="h-24 w-full rounded-xl border border-line bg-sand-50 p-3 font-mono text-xs outline-none focus:border-ink-500"
              placeholder='Merchant only: paste {"inputs":…,"salt":…} (saved by /merchant/capital in this browser)'
              value={sealed}
              onChange={(e) => setSealed(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    setSealed(localStorage.getItem(`runway:sealed:${offer.id}`) ?? "");
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                Load from this browser
              </Button>
              <Button
                onClick={() => {
                  try {
                    const s = JSON.parse(sealed) as { inputs: unknown; salt: string };
                    setCommitOk(verifyCommitment(offer.inputs_commitment, s.inputs, s.salt));
                  } catch {
                    setCommitOk(false);
                  }
                }}
              >
                Recompute commitment
              </Button>
              {commitOk !== null && (
                <Badge tone={commitOk ? "good" : "bad"}>{commitOk ? "matches" : "does not match"}</Badge>
              )}
            </div>
          </div>
        </Card>
        <Card
          title="Settlement account"
          description="Where this merchant's payments go: the standard program, with no keys."
        >
          <ul className="space-y-2">
            <Check
              ok={acct?.code_hash === factoryHash}
              label="Code hash equals the factory's settlement hash"
              detail={acct?.code_hash ?? "—"}
            />
            <Check
              ok={keys === 0}
              label="No access keys (nobody can sign for it)"
              detail={`${keys ?? "?"} keys`}
            />
          </ul>
        </Card>
      </div>
      {!approved.requires_tee && (
        <div className="mt-6">
          <Callout tone="info">
            “Contract requires a TEE” shows ✖ on testnet by design: the agents run in local mode. Every other
            check is the same as on mainnet.
          </Callout>
        </div>
      )}
    </Container>
  );
}
