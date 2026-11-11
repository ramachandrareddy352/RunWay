// Sandbox stand-in for the TEE underwriter (BUILD_PLAN T1.9). It runs the same deterministic
// `@runway/scoring` formula and submits offers from a whitelisted local-mode agent account.
//
// Labelled honestly in its output:
//   - revenueSource "sandbox-buckets": the settlement's on-chain buckets (there is no 1Click in a sandbox)
//   - payer data: unknown (diversity scores 0)
//   - anchor: a sandbox fixture, not KYC

import { base58Encode, completeBuckets, type Bucket } from "@runway/sdk";
import { score, scoringPolicy, median, window, type Decision, type Features } from "@runway/scoring";
import { nowSec, profile, sha256, type Stack } from "./sandbox.js";

export interface UnderwriteResult {
  features: Features;
  decision: Decision;
  offerId?: string;
  anchorHash: string;
  buckets: bigint[];
}

export async function underwrite(s: Stack, handle: string, settlement: string): Promise<UnderwriteResult> {
  const st = s.root.getAccount(settlement);
  const raw = await st.view<Bucket[]>("get_buckets");
  const state = await st.view<{ current_bucket: string }>("get_state");
  const buckets = completeBuckets(raw, BigInt(state.current_bucket));
  const m = await s.credit.view<{
    record: { loans_repaid: number; loans_defaulted: number };
    merchant: { frozen: boolean };
  }>("get_merchant", { handle });

  const anchorHash = base58Encode(sha256(`sandbox-anchor:${handle}`));
  const R = median(window(buckets));
  const inputs = {
    buckets,
    anchorMedian: R, // sandbox fixture: the "anchor" corroborates the routed revenue exactly
    repaid: m.record.loans_repaid,
    defaulted: m.record.loans_defaulted > 0,
    frozen: m.merchant.frozen,
    anchored: true,
  };
  const { features, decision } = score(inputs, scoringPolicy(profile.policy));
  if (decision.kind !== "offer") return { features, decision, anchorHash, buckets };

  const salt = sha256(`salt:${handle}:${Date.now()}`);
  const canonical = JSON.stringify({
    v: 1,
    revenueSource: profile.revenueSource,
    handle,
    buckets: buckets.map(String),
    repaid: inputs.repaid,
    anchor: "sandbox-fixture",
  });
  const commitment = base58Encode(sha256(Buffer.concat([Buffer.from(canonical), salt])));
  const chainSec = await nowSec(s);
  const offerId = await s.agent.call<string>(s.credit, "submit_offer", {
    handle,
    limit: String(decision.limit),
    fee_bps: decision.feeBps,
    repay_bps: decision.repayBps,
    grade: decision.grade,
    anchor_hash: anchorHash,
    inputs_commitment: commitment,
    llm_receipt_hash: null,
    expires_at_sec: String(chainSec + 300),
    policy_version: profile.policy.version,
  });
  return { features, decision, offerId, anchorHash, buckets };
}
