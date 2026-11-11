// Deterministic credit formula (design §10, BUILD_PLAN T1.7).
// Fixed-point bigint only: ratios are scaled by SCALE (1e6), money is micro-USDC. No floats.
// The contract re-checks the hard bounds; this package decides grade, limit, fee and repay share.

export const SCALE = 1_000_000n;
export const BPS = 10_000n;

export type Grade = "A" | "B" | "C";

export interface ScoringPolicy {
  /** by loans_repaid (index = min(repaid, 3)) */
  anchoredCaps: bigint[];
  unanchoredCaps: bigint[];
  minLoan: bigint;
  maxExposure: bigint;
  repayBpsMin: number;
  repayBpsMax: number;
  /** Eligibility: median routed revenue per bucket must be at least this (default 300 USDC). */
  minRevenue: bigint;
  /** Eligibility: top payer share must not exceed this when known (default 0.6). */
  maxTopPayerShare: bigint;
  /** Eligibility: buckets with revenue in the window (default 3). */
  minActiveBuckets: number;
}

export interface Inputs {
  /** Complete buckets of verified routed revenue (micro-USDC), oldest → newest. Leading zeros allowed. */
  buckets: bigint[];
  /** Routed revenue per payer within the window; undefined when payer data is unavailable. */
  payers?: Map<string, bigint>;
  /** Median per-bucket revenue from the identity anchor (Stripe/Razorpay), micro-USDC. */
  anchorMedian?: bigint;
  /** Median per-bucket revenue extracted from statements, micro-USDC. */
  statementMedian?: bigint;
  repaid: number;
  defaulted: boolean;
  frozen: boolean;
  anchored: boolean;
}

export interface Features {
  /** window length */
  n: number;
  /** buckets with revenue > 0 */
  H: number;
  /** median routed revenue per bucket */
  R: bigint;
  /** coefficient of variation × SCALE (population σ / μ) */
  CV: bigint;
  /** trend × SCALE: mean(last 2) / mean(others); SCALE if others are empty or zero */
  T: bigint;
  /** top payer share × SCALE, or null when unknown */
  Ctop: bigint | null;
  /** corroboration × SCALE in [0, SCALE] */
  corr: bigint;
}

export type DeclineReason =
  "too_new" | "low_revenue" | "defaulted" | "frozen" | "concentrated" | "low_score" | "below_min_loan";

export type Decision =
  | {
      kind: "offer";
      grade: Grade;
      /** score × SCALE, in [0, 100 × SCALE] */
      S: bigint;
      limit: bigint;
      feeBps: number;
      fee: bigint;
      owed: bigint;
      repayBps: number;
      reasons: string[];
    }
  | { kind: "decline"; reason: DeclineReason; reasons: string[] };

/** Payer data must cover ≥ 80% of routed revenue for C_top to be known (design §10.1). */
export const MIN_PAYER_COVERAGE = 800_000n;

const GRADE_K: Record<Grade, bigint> = { A: 1_000_000n, B: 600_000n, C: 300_000n };
const GRADE_FEE: Record<Grade, number> = { A: 400, B: 700, C: 1000 };
const WEIGHTS = { stability: 35n, history: 25n, diversity: 15n, trend: 15n, corr: 10n };

const min = (...v: bigint[]): bigint => v.reduce((a, b) => (b < a ? b : a));
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Integer square root (floor), Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Median; for an even count, floor of the mean of the two middle values. */
export function median(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}

const mean = (v: bigint[]): bigint =>
  v.length === 0 ? 0n : v.reduce((a, b) => a + b, 0n) / BigInt(v.length);

/** From the first non-zero bucket, at most the last 6. Zero buckets inside the window count as 0. */
export function window(buckets: bigint[]): bigint[] {
  const first = buckets.findIndex((b) => b > 0n);
  if (first < 0) return [];
  return buckets.slice(first).slice(-6);
}

export function features(i: Inputs): Features {
  const m = window(i.buckets);
  const n = m.length;
  const H = m.filter((v) => v > 0n).length;
  const R = median(m);
  const mu = mean(m);
  let CV = 0n;
  if (mu > 0n) {
    const variance = m.reduce((acc, v) => acc + (v - mu) * (v - mu), 0n) / BigInt(n);
    CV = (isqrt(variance) * SCALE) / mu;
  }
  let T = SCALE;
  if (n >= 3) {
    const last2 = mean(m.slice(-2));
    const rest = mean(m.slice(0, -2));
    T = rest > 0n ? (last2 * SCALE) / rest : SCALE;
  }
  // C_top is known only when payer data covers at least 80% of routed revenue in the window.
  let Ctop: bigint | null = null;
  if (i.payers && i.payers.size > 0) {
    const totalRouted = m.reduce((a, b) => a + b, 0n);
    const covered = [...i.payers.values()].reduce((a, b) => a + b, 0n);
    const top = [...i.payers.values()].reduce((a, b) => max(a, b), 0n);
    const coverage = totalRouted > 0n ? (covered * SCALE) / totalRouted : 0n;
    if (covered > 0n && coverage >= MIN_PAYER_COVERAGE) Ctop = (top * SCALE) / covered;
  }
  let corr = 0n;
  if (R > 0n) {
    if (i.anchorMedian !== undefined) corr += min(SCALE, (i.anchorMedian * SCALE) / R);
    if (i.statementMedian !== undefined) corr += min(SCALE / 2n, (i.statementMedian * SCALE) / (2n * R));
  }
  corr = min(corr, SCALE);
  return { n, H, R, CV, T, Ctop, corr };
}

/** Score, grade and terms from features (design §10.3). */
export function decide(
  f: Features,
  i: Pick<Inputs, "repaid" | "defaulted" | "frozen" | "anchored">,
  p: ScoringPolicy,
): Decision {
  const reasons: string[] = [];
  if (i.defaulted)
    return { kind: "decline", reason: "defaulted", reasons: ["merchant has a default on record"] };
  if (i.frozen) return { kind: "decline", reason: "frozen", reasons: ["merchant is frozen"] };
  if (f.H < p.minActiveBuckets)
    return {
      kind: "decline",
      reason: "too_new",
      reasons: [`needs ${p.minActiveBuckets} buckets of revenue history`],
    };
  if (f.R < p.minRevenue)
    return { kind: "decline", reason: "low_revenue", reasons: ["median routed revenue too low"] };
  if (f.Ctop !== null && f.Ctop > p.maxTopPayerShare)
    return { kind: "decline", reason: "concentrated", reasons: ["revenue too concentrated in one payer"] };

  const stability = clamp(SCALE - f.CV, 0n, SCALE);
  const history = (BigInt(Math.min(i.repaid, 4)) * SCALE) / 4n;
  const diversity = f.Ctop === null ? 0n : clamp(SCALE - f.Ctop, 0n, SCALE);
  const trend = clamp(f.T - SCALE / 2n, 0n, SCALE);
  const S =
    WEIGHTS.stability * stability +
    WEIGHTS.history * history +
    WEIGHTS.diversity * diversity +
    WEIGHTS.trend * trend +
    WEIGHTS.corr * f.corr;
  if (f.Ctop === null) reasons.push("payer data unavailable: diversity scored as 0");

  let grade: Grade;
  if (S >= 75n * SCALE) grade = "A";
  else if (S >= 55n * SCALE) grade = "B";
  else if (S >= 40n * SCALE) grade = "C";
  else return { kind: "decline", reason: "low_score", reasons: [...reasons, `score ${fmt(S)} below 40`] };

  const feeBps = GRADE_FEE[grade];
  const caps = i.anchored ? p.anchoredCaps : p.unanchoredCaps;
  const cap = caps[Math.min(i.repaid, 3)]!;
  const repayable = (3n * f.R * BigInt(p.repayBpsMax)) / (BPS + BigInt(feeBps));
  const limit = min((f.R * GRADE_K[grade]) / SCALE, cap, p.maxExposure, repayable);
  if (limit < p.minLoan) return { kind: "decline", reason: "below_min_loan", reasons };
  const fee = (limit * BigInt(feeBps)) / BPS;
  const owed = limit + fee;
  const repayBps = Number(clamp(ceilDiv(owed * BPS, 3n * f.R), BigInt(p.repayBpsMin), BigInt(p.repayBpsMax)));
  reasons.push(
    `score ${fmt(S)} → grade ${grade}`,
    `limit bounded by ${bound(limit, grade, cap, p.maxExposure, repayable)}`,
  );
  return { kind: "offer", grade, S, limit, feeBps, fee, owed, repayBps, reasons };
}

export function score(i: Inputs, p: ScoringPolicy): { features: Features; decision: Decision } {
  const f = features(i);
  return { features: f, decision: decide(f, i, p) };
}

function fmt(S: bigint): string {
  const whole = S / SCALE;
  const frac = ((S % SCALE) * 100n) / SCALE;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

function bound(limit: bigint, g: Grade, cap: bigint, exposure: bigint, repayable: bigint): string {
  if (limit === cap) return "tier cap";
  if (limit === repayable) return "repayability (3 buckets at max share)";
  if (limit === exposure) return "max exposure";
  return `R × k(${g})`;
}

/** Default scoring policy derived from the on-chain policy caps. */
export function scoringPolicy(onChain: {
  anchoredCaps: bigint[];
  unanchoredCaps: bigint[];
  minLoan: bigint;
  maxExposurePerMerchant: bigint;
  repayBpsMin: number;
  repayBpsMax: number;
}): ScoringPolicy {
  return {
    anchoredCaps: onChain.anchoredCaps,
    unanchoredCaps: onChain.unanchoredCaps,
    minLoan: onChain.minLoan,
    maxExposure: onChain.maxExposurePerMerchant,
    repayBpsMin: onChain.repayBpsMin,
    repayBpsMax: onChain.repayBpsMax,
    minRevenue: 300_000_000n,
    maxTopPayerShare: 600_000n,
    minActiveBuckets: 3,
  };
}
