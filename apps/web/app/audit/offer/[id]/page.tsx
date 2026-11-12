"use client";
// /audit/offer/[id] (BUILD_PLAN T5.5): the offer's fields, the contract's hard bounds re-evaluated
// in the browser, the agent's measurements and role, the anchor flag, the commitment (checkable
// against sealed inputs), the LLM receipt hash, and the settlement account's code hash and keys.
import { accessKeyCount, verifyCommitment, viewAccount } from "@runway/sdk";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, Stat } from "../../../../components/ui";
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
  <li className="flex gap-2 text-sm" data-ok={String(ok)}>
    <span className={ok ? "text-good" : "text-bad"}>{ok ? "✔" : "✖"}</span>
    <span className="font-medium">{label}</span>
    <span className="text-subtle">{detail}</span>
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

  if (d.error) return <ErrorText error={d.error} />;
  if (!d.data) return <p className="text-sm text-subtle">{d.loading ? "Loading…" : `No offer #${id}.`}</p>;
  const { offer, policy, approved, agent, merchant, factoryHash, acct, keys } = d.data;
  const repaid = Math.min(merchant?.record.loans_repaid ?? 0, 3);
  const caps = offer.anchor_hash ? policy.anchored_caps : policy.unanchored_caps;
  const cap = BigInt(caps[repaid] ?? "0");
  const limit = BigInt(offer.limit);
  const role =
    approved.measurements.find((m) => m.measurements_hash === offer.measurements_hash)?.role ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        Offer #{offer.id} for {offer.handle} <Badge>{offer.status}</Badge>
      </h1>
      <Card title="Terms">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Grade" value={offer.grade} />
          <Stat label="Limit" value={fmtUsdc(offer.limit)} />
          <Stat label="Fee" value={bps(offer.fee_bps)} />
          <Stat label="Repay share" value={bps(offer.repay_bps)} />
        </div>
      </Card>
      <Card title="Contract bounds, re-checked here">
        <ul className="space-y-1">
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
      <Card title="Who made it">
        <ul className="space-y-1">
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
      <Card title="Evidence">
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
            className="h-24 w-full rounded-lg border border-line bg-bg p-2 font-mono text-xs"
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
      <Card title="Settlement account">
        <ul className="space-y-1">
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
  );
}
