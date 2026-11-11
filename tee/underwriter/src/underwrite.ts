// The /underwrite pipeline (design §8.4, BUILD_PLAN T3.3):
//   authenticate → one-block chain snapshot → routed revenue → optional evidence (anchor, statements)
//   → @runway/scoring → commitment → submit_offer. A decline writes nothing on-chain.
// Evidence failures drop that evidence with a reason (fail closed for evidence); chain or auth
// failures abort the request (fail closed for lending).
import {
  score,
  scoringPolicy,
  median,
  window,
  type Decision,
  type Features,
  type Inputs,
} from "@runway/scoring";
import type { Oracle } from "@runway/fx";
import type { Bucket, MerchantView, PayinReceipt, SignedMessage, Status } from "@runway/sdk";
import { authenticate, type NonceCache } from "./auth.js";
import { commitment, newSalt, saltToB64 } from "./commit.js";
import type { Endpoints } from "./endpoints.js";
import {
  errorCode,
  hmacB58,
  TGAS,
  type AgentSigner,
  type AppKeySource,
  type Logger,
  type Reader,
} from "@runway/agent-kit";
import type { NearAi } from "./nearai.js";
import { razorpayAnchor, type RazorpayAnchorInput } from "./razorpay-anchor.js";
import { bucketRevenue, verifiedRevenue, type Revenue } from "./revenue.js";
import { statementText, type StatementFile } from "./statement.js";
import { stripeAnchor } from "./stripe.js";

export interface UnderwriteRequest {
  handle: string;
  nep413: SignedMessage;
  /** Stripe restricted key (read-only). Used once, never stored. */
  stripe_key?: string;
  razorpay?: RazorpayAnchorInput;
  statements?: StatementFile[];
}

export interface UnderwriteDeps {
  endpoints: Endpoints;
  reader: Reader;
  signer: AgentSigner;
  nonces: NonceCache;
  keys: AppKeySource;
  log: Logger;
  /** Absent → statements are skipped with "NEAR AI not configured". */
  nearai?: NearAi;
  /** Razorpay anchor rates. */
  oracle?: Oracle;
  /** Mainnet only: the untrusted payment log and 1Click status. */
  paymentLog?: (handle: string) => Promise<{ depositAddress: string }[]>;
  oneclickStatus?: (depositAddress: string) => Promise<Status>;
  /** Sandbox only: a labelled fixture anchor so the scripted demo can reach anchored tiers. */
  sandboxFixtureAnchor?: boolean;
  fetch?: typeof fetch;
}

export interface Evidence {
  revenue: { source: Revenue["source"]; labels: string[]; excluded: number };
  anchor: {
    kind: "stripe" | "razorpay" | "sandbox-fixture";
    hash: string;
    testMode: boolean;
    notes: string[];
  } | null;
  statement: { model: string; receiptHash: string; months: number } | null;
}

export interface UnderwriteResult {
  decision: "offer" | "decline";
  offer_id?: string;
  reasons: string[];
  terms?: { grade: string; limit: string; fee_bps: number; repay_bps: number; expires_at_sec: number };
  evidence: Evidence;
  /** Sealed to the merchant: everything needed to recompute the on-chain commitment. */
  inputs: Record<string, unknown>;
  salt: string;
  commitment?: string;
  features: Features;
}

export class RequestRejected extends Error {
  constructor(
    readonly status: 400 | 401 | 404,
    message: string,
  ) {
    super(message);
  }
}

interface ChainPolicy {
  version: number;
  anchored_caps: string[];
  unanchored_caps: string[];
  min_loan: string;
  max_exposure_per_merchant: string;
  repay_bps_min: number;
  repay_bps_max: number;
}

interface ChainConfig {
  inr_gateway: string | null;
  time: { offer_ttl_sec: number };
}

export async function underwrite(req: UnderwriteRequest, d: UnderwriteDeps): Promise<UnderwriteResult> {
  const started = Date.now();
  const { endpoints: ep } = d;
  const snap = await d.reader.snapshot();
  const view = snap.view;

  const m = await view<MerchantView | null>(ep.credit, "get_merchant", { handle: req.handle });
  if (!m) throw new RequestRejected(404, "unknown merchant");
  const auth = await authenticate(req.nep413, req.handle, m.merchant.payout, {
    rpc: { ...d.reader.rpc, blockId: undefined },
    seen: d.nonces,
  });
  if (!auth.ok) throw new RequestRejected(401, auth.reason);

  // Everything below reads the same block on every RPC.
  const [config, policy, state, raw] = await Promise.all([
    view<ChainConfig>(ep.credit, "get_config"),
    view<ChainPolicy>(ep.credit, "get_policy"),
    view<{ current_bucket: string; bucket_sec: string }>(m.merchant.settlement, "get_state"),
    view<Bucket[]>(m.merchant.settlement, "get_buckets"),
  ]);
  const receipts = config.inr_gateway
    ? await view<[string, PayinReceipt][]>(config.inr_gateway, "get_payins_by_handle", {
        handle: req.handle,
        from: "0",
        limit: 200,
      })
    : [];
  const currentBucket = BigInt(state.current_bucket);
  const bucketSec = BigInt(state.bucket_sec);

  const revenue =
    ep.profile.revenueSource === "1click-verified"
      ? await verifiedRevenue({
          settlement: m.merchant.settlement,
          payments: d.paymentLog ? await d.paymentLog(req.handle) : [],
          status: d.oneclickStatus ?? (() => Promise.reject(new Error("1Click status not configured"))),
          raw,
          currentBucket,
          bucketSec,
          receipts,
        })
      : bucketRevenue({ source: ep.profile.revenueSource, raw, currentBucket, bucketSec, receipts });

  const reasons: string[] = [...revenue.labels];
  const evidence: Evidence = {
    revenue: { source: revenue.source, labels: revenue.labels, excluded: revenue.excluded.length },
    anchor: null,
    statement: null,
  };
  const R = median(window(revenue.buckets));
  const windowStartSec = Number(
    (currentBucket - BigInt(Math.max(window(revenue.buckets).length, 1))) * bucketSec,
  );
  const kApp = await d.keys.appKey("runway/anchor/v1");

  // ---- identity anchor (one source) ----
  let anchorMedian: bigint | undefined;
  try {
    if (req.stripe_key) {
      const s = await stripeAnchor(req.stripe_key, {
        network: ep.network,
        base: ep.stripe,
        kApp,
        windowStartSec,
        bucketSec: Number(bucketSec),
        currentBucket,
        fetch: d.fetch,
      });
      evidence.anchor = { kind: "stripe", hash: s.anchorHash, testMode: s.testMode, notes: s.notes };
      anchorMedian = s.medianPerBucket;
    } else if (req.razorpay) {
      if (!d.oracle) throw new Error("no FX oracle for the Razorpay anchor");
      const r = await razorpayAnchor(req.razorpay, {
        network: ep.network,
        base: "https://api.razorpay.com",
        kApp,
        oracle: d.oracle,
        spreadBps: 0,
        windowStartSec,
        bucketSec: Number(bucketSec),
        currentBucket,
        fetch: d.fetch,
      });
      evidence.anchor = { kind: "razorpay", hash: r.anchorHash, testMode: r.testMode, notes: r.notes };
      anchorMedian = r.medianPerBucket;
    } else if (d.sandboxFixtureAnchor && ep.network === "sandbox") {
      evidence.anchor = {
        kind: "sandbox-fixture",
        hash: hmacB58(kApp, `sandbox:${req.handle}`),
        testMode: true,
        notes: ["sandbox fixture, not KYC"],
      };
      anchorMedian = R;
    }
  } catch (e) {
    reasons.push(`anchor dropped: ${(e as Error).message}`);
    d.log.warn("anchor_dropped", { handle: req.handle, code: errorCode(e) });
  }
  if (evidence.anchor)
    reasons.push(
      `anchor: ${evidence.anchor.kind}${evidence.anchor.notes.length ? ` (${evidence.anchor.notes.join("; ")})` : ""}`,
    );

  // ---- statements (corroboration only) ----
  let statementMedian: bigint | undefined;
  let llmReceipt: string | null = null;
  if (req.statements && req.statements.length > 0) {
    if (!d.nearai) reasons.push("statements skipped: NEAR AI not configured");
    else {
      try {
        const texts = await Promise.all(req.statements.slice(0, 3).map(statementText));
        const st = await d.nearai.extract(texts.join("\n\n"));
        statementMedian = st.medianMonthly;
        llmReceipt = st.receiptHash;
        evidence.statement = { model: st.model, receiptHash: st.receiptHash, months: st.months.length };
        reasons.push(`statements: verified private inference (${st.model})`);
      } catch (e) {
        reasons.push(`statements dropped: ${(e as Error).message}`);
        d.log.warn("statements_dropped", { handle: req.handle, code: errorCode(e) });
      }
    }
  }

  const inputs: Inputs = {
    buckets: revenue.buckets,
    payers: revenue.payers.size > 0 ? revenue.payers : undefined,
    anchorMedian,
    statementMedian,
    repaid: m.record.loans_repaid,
    defaulted: m.record.loans_defaulted > 0,
    frozen: m.merchant.frozen,
    anchored: evidence.anchor !== null,
  };
  const { features, decision } = score(
    inputs,
    scoringPolicy({
      anchoredCaps: policy.anchored_caps.map(BigInt),
      unanchoredCaps: policy.unanchored_caps.map(BigInt),
      minLoan: BigInt(policy.min_loan),
      maxExposurePerMerchant: BigInt(policy.max_exposure_per_merchant),
      repayBpsMin: policy.repay_bps_min,
      repayBpsMax: policy.repay_bps_max,
    }),
  );
  reasons.push(...decision.reasons);

  const committed = commitInputs(
    req.handle,
    ep,
    snap.height,
    revenue,
    evidence,
    inputs,
    decision,
    policy.version,
  );
  const salt = newSalt();
  const base = { evidence, inputs: committed, salt: saltToB64(salt), features };
  if (decision.kind !== "offer") {
    d.log.info("underwrite", {
      handle: req.handle,
      decision: "decline",
      reason: decision.reason,
      ms: Date.now() - started,
    });
    salt.fill(0);
    return { decision: "decline", reasons, ...base };
  }

  const c = commitment(committed, salt);
  salt.fill(0);
  const expires = snap.timestampSec + config.time.offer_ttl_sec;
  const offerId = await d.signer.call<string>(
    "submit_offer",
    {
      handle: req.handle,
      limit: String(decision.limit),
      fee_bps: decision.feeBps,
      repay_bps: decision.repayBps,
      grade: decision.grade,
      anchor_hash: evidence.anchor?.hash ?? null,
      inputs_commitment: c,
      llm_receipt_hash: llmReceipt,
      expires_at_sec: String(expires),
      policy_version: policy.version,
    },
    { gas: 50n * TGAS },
  );
  d.log.info("underwrite", {
    handle: req.handle,
    decision: "offer",
    offer_id: String(offerId),
    ms: Date.now() - started,
  });
  return {
    decision: "offer",
    offer_id: String(offerId),
    reasons,
    terms: {
      grade: decision.grade,
      limit: String(decision.limit),
      fee_bps: decision.feeBps,
      repay_bps: decision.repayBps,
      expires_at_sec: expires,
    },
    commitment: c,
    ...base,
  };
}

/** The canonical object behind `inputs_commitment` (no secrets: keys and statement text never enter it). */
function commitInputs(
  handle: string,
  ep: Endpoints,
  height: number,
  revenue: Revenue,
  evidence: Evidence,
  i: Inputs,
  decision: Decision,
  policyVersion: number,
): Record<string, unknown> {
  return {
    v: 1,
    network: ep.network,
    handle,
    block_height: height,
    revenue_source: revenue.source,
    buckets: i.buckets.map(String),
    payers: [...revenue.payers.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [k, String(v)]),
    inr_receipts: revenue.inr.delivered,
    anchor: evidence.anchor
      ? { kind: evidence.anchor.kind, hash: evidence.anchor.hash, median: String(i.anchorMedian ?? 0n) }
      : null,
    statement: evidence.statement
      ? { receipt: evidence.statement.receiptHash, median: String(i.statementMedian ?? 0n) }
      : null,
    repaid: i.repaid,
    defaulted: i.defaulted,
    frozen: i.frozen,
    policy_version: policyVersion,
    decision:
      decision.kind === "offer"
        ? {
            grade: decision.grade,
            limit: String(decision.limit),
            fee_bps: decision.feeBps,
            repay_bps: decision.repayBps,
          }
        : { decline: decision.reason },
  };
}
