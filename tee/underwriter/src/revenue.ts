// Routed revenue (design §8.4 step 3, §9A.9; BUILD_PLAN T3.3 step 4, T4b.8).
//
//   sandbox / testnet ("*-buckets"): the settlement's on-chain buckets. They already include USDC the
//     INR gateway delivered, so UPI receipts add payer data and labels here, not revenue.
//   mainnet ("1click-verified"): only deliveries the agent re-verified itself: 1Click payments from
//     the untrusted log (SUCCESS, signed quote, recipient = settlement, USDC out) plus Delivered UPI
//     receipts written by the attested gateway. Verified must never exceed the raw on-chain bucket.
import {
  completeBuckets,
  USDC_NEAR_ASSET,
  verifyQuote,
  type Bucket,
  type PayinReceipt,
  type Status,
} from "@runway/sdk";

export type RevenueSource = "sandbox-buckets" | "testnet-buckets" | "1click-verified";

export interface InrSummary {
  delivered: number;
  ignored: number;
  usdc: bigint;
  simulated: boolean;
}

export interface Revenue {
  source: RevenueSource;
  /** Complete buckets oldest → newest (micro-USDC). */
  buckets: bigint[];
  /** Routed revenue per payer, where the payer is known. */
  payers: Map<string, bigint>;
  inr: InrSummary;
  excluded: { ref: string; reason: string }[];
  labels: string[];
}

function add<K>(m: Map<K, bigint>, k: K, v: bigint): void {
  m.set(k, (m.get(k) ?? 0n) + v);
}

/** Delivered UPI sales by bucket (current bucket excluded); Delivering/Failed receipts are ignored. */
export function inrReceipts(
  receipts: [string, PayinReceipt][],
  bucketSec: bigint,
  currentBucket: bigint,
  simulated: boolean,
): { perBucket: Map<bigint, bigint>; payers: Map<string, bigint>; summary: InrSummary } {
  const perBucket = new Map<bigint, bigint>();
  const payers = new Map<string, bigint>();
  const summary: InrSummary = { delivered: 0, ignored: 0, usdc: 0n, simulated };
  for (const [, r] of receipts) {
    const delivered = BigInt(r.delivered);
    const bucket = BigInt(r.at_sec) / bucketSec;
    if (
      r.kind.type !== "merchant_sale" ||
      r.status !== "Delivered" ||
      delivered === 0n ||
      bucket >= currentBucket
    ) {
      summary.ignored += 1;
      continue;
    }
    add(perBucket, bucket, delivered);
    if (r.payer_ref_hash) add(payers, `upi:${r.payer_ref_hash}`, delivered);
    summary.delivered += 1;
    summary.usdc += delivered;
  }
  return { perBucket, payers, summary };
}

function inrLabel(s: InrSummary): string[] {
  if (s.delivered === 0) return [];
  return [
    `${s.delivered} UPI receipt${s.delivered === 1 ? "" : "s"}${s.simulated ? " (simulated UPI)" : ""}`,
  ];
}

/** sandbox / testnet: on-chain buckets, plus UPI payer data and labels. */
export function bucketRevenue(p: {
  source: "sandbox-buckets" | "testnet-buckets";
  raw: Bucket[];
  currentBucket: bigint;
  bucketSec: bigint;
  receipts: [string, PayinReceipt][];
}): Revenue {
  const inr = inrReceipts(p.receipts, p.bucketSec, p.currentBucket, true);
  return {
    source: p.source,
    buckets: completeBuckets(p.raw, p.currentBucket),
    payers: inr.payers,
    inr: inr.summary,
    excluded: [],
    labels: [`revenue: ${p.source} (on-chain inflow, not 1Click-verified)`, ...inrLabel(inr.summary)],
  };
}

/** mainnet: re-verify each logged 1Click payment and add Delivered UPI receipts; never above raw. */
export async function verifiedRevenue(p: {
  settlement: string;
  payments: { depositAddress: string }[];
  status: (depositAddress: string) => Promise<Status>;
  raw: Bucket[];
  currentBucket: bigint;
  bucketSec: bigint;
  receipts: [string, PayinReceipt][];
}): Promise<Revenue> {
  const verified = new Map<bigint, bigint>();
  const payers = new Map<string, bigint>();
  const excluded: Revenue["excluded"] = [];
  const seen = new Set<string>();
  for (const { depositAddress } of p.payments) {
    if (seen.has(depositAddress)) continue;
    seen.add(depositAddress);
    let s: Status;
    try {
      s = await p.status(depositAddress);
    } catch (e) {
      excluded.push({ ref: depositAddress, reason: `status unavailable: ${(e as Error).message}` });
      continue;
    }
    const reason = checkDelivery(s, depositAddress, p.settlement);
    if (reason) {
      excluded.push({ ref: depositAddress, reason });
      continue;
    }
    const at = Math.floor(Date.parse(s.updatedAt) / 1000);
    const bucket = BigInt(at) / p.bucketSec;
    if (bucket >= p.currentBucket) continue;
    const amount = BigInt(s.swapDetails.amountOut!);
    add(verified, bucket, amount);
    const req = s.quoteResponse.quoteRequest;
    add(payers, `${req.originAsset}|${req.refundTo}`, amount);
  }
  const inr = inrReceipts(p.receipts, p.bucketSec, p.currentBucket, false);
  for (const [b, v] of inr.perBucket) add(verified, b, v);
  for (const [k, v] of inr.payers) add(payers, k, v);

  // The log can only omit payments, never invent them: verified ≤ raw in every bucket.
  const raw = new Map(p.raw.map((b) => [BigInt(b.bucket), BigInt(b.inflow)]));
  for (const [b, v] of verified) {
    if (v > (raw.get(b) ?? 0n)) throw new Error(`verified revenue exceeds on-chain inflow in bucket ${b}`);
  }
  const buckets = completeBuckets(
    [...verified].map(([bucket, inflow]) => ({ bucket: String(bucket), inflow: String(inflow) })),
    p.currentBucket,
  );
  return {
    source: "1click-verified",
    buckets,
    payers,
    inr: inr.summary,
    excluded,
    labels: ["revenue: 1Click-verified deliveries", ...inrLabel(inr.summary)],
  };
}

/** Why a logged payment can't count, or undefined when it is a verified delivery to `settlement`. */
export function checkDelivery(s: Status, depositAddress: string, settlement: string): string | undefined {
  if (s.status !== "SUCCESS") return `status ${s.status}`;
  // The deadline is in the past for any completed swap, so only the binding checks apply here.
  const report = verifyQuote(s.quoteResponse, {
    settlement,
    usdcAssetId: USDC_NEAR_ASSET,
    minOut: 0n,
    now: new Date(0),
    dry: false,
  });
  for (const id of ["signature", "recipient", "destinationAsset"] as const) {
    const c = report.checks.find((x) => x.id === id);
    if (!c?.ok) return `${id}: ${c?.detail ?? "missing"}`;
  }
  if (s.quoteResponse.quote.depositAddress !== depositAddress)
    return "status is for a different deposit address";
  const out = s.swapDetails?.amountOut;
  if (!out || !/^\d+$/.test(out) || BigInt(out) === 0n) return "no amountOut";
  if (!Number.isFinite(Date.parse(s.updatedAt))) return "no updatedAt";
  return undefined;
}
