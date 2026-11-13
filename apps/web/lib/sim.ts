// Previews of what the protocol will do, computed in the browser. Each function mirrors the
// contracts' integer maths exactly (settlement split, credit router/loans/vault, shared/fx) or calls
// the underwriter's own scoring package, so a preview matches the chain to the last micro-USDC.
// They only predict: the contracts and the underwriter agent decide.
import {
  decide,
  features,
  scoringPolicy,
  SCALE,
  type Decision,
  type Features,
  type Grade,
} from "@runway/scoring";
import { PROFILE } from "./env";

export const BPS = 10_000n;
/** contracts/shared consts.rs: protects the share price from donation and rounding attacks. */
export const VIRTUAL_OFFSET = 1_000_000n;
const POLICY = PROFILE.policy;

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

// ---------- payment split (contracts/settlement on_balance) ----------

/** repay = floor(inflow × repay_bps / 10,000); the merchant gets the rest. No loan → repay = 0. */
export function splitPayment(inflow: bigint, repayBps: number | null | undefined) {
  const repay = repayBps ? (inflow * BigInt(repayBps)) / BPS : 0n;
  return { repay, merchant: inflow - repay };
}

// ---------- loans (contracts/credit loans.rs) ----------

/** accept_offer: drawing less than the limit scales the repay share down (never below the minimum). */
export function drawTerms(offer: { limit: bigint; feeBps: number; repayBps: number }, amount: bigint) {
  const scaled = Number(ceilDiv(BigInt(offer.repayBps) * amount, offer.limit));
  const repayBps = Math.max(scaled, POLICY.repayBpsMin);
  const fee = (amount * BigInt(offer.feeBps)) / BPS;
  return { repayBps, fee, owed: amount + fee };
}

/** The least that must be repaid in each loan period to avoid a missed period. */
export const periodRequirement = (owed: bigint, remaining: bigint = owed) =>
  min((owed * BigInt(POLICY.minPeriodRepayBps)) / BPS, remaining);

export interface LoanBook {
  principal: bigint;
  owed: bigint;
  repaid: bigint;
  principalRepaid: bigint;
}

export interface RepayStep {
  inflow: bigint;
  /** the settlement account's repay part */
  repayPart: bigint;
  /** what the loan actually took (never more than is still owed) */
  applied: bigint;
  principalPart: bigint;
  feePart: bigint;
  toReserve: bigint;
  toLenders: bigint;
  toMerchant: bigint;
  repaidAfter: bigint;
  remainingAfter: bigint;
  done: boolean;
}

/** One settled payment against an open loan: settlement split, then credit apply_regular. */
export function applyPayment(
  loan: LoanBook,
  inflow: bigint,
  repayBps: number,
): { step: RepayStep; loan: LoanBook } {
  const { repay } = splitPayment(inflow, repayBps);
  const a = min(repay, loan.owed - loan.repaid);
  const repaid = loan.repaid + a;
  const principalRepaid = repaid === loan.owed ? loan.principal : (repaid * loan.principal) / loan.owed;
  const principalPart = principalRepaid - loan.principalRepaid;
  const feePart = a - principalPart;
  const toReserve = (feePart * BigInt(POLICY.protocolFeeShareBps)) / BPS;
  const next = { ...loan, repaid, principalRepaid };
  return {
    loan: next,
    step: {
      inflow,
      repayPart: repay,
      applied: a,
      principalPart,
      feePart,
      toReserve,
      toLenders: a - toReserve,
      toMerchant: inflow - a,
      repaidAfter: repaid,
      remainingAfter: loan.owed - repaid,
      done: repaid === loan.owed,
    },
  };
}

/** A whole loan: draw, then each payment in order until it is repaid. */
export function simulateLoan(principal: bigint, feeBps: number, repayBps: number, payments: bigint[]) {
  const fee = (principal * BigInt(feeBps)) / BPS;
  let loan: LoanBook = { principal, owed: principal + fee, repaid: 0n, principalRepaid: 0n };
  const steps: RepayStep[] = [];
  for (const p of payments) {
    if (loan.repaid === loan.owed) {
      steps.push({
        inflow: p,
        repayPart: 0n,
        applied: 0n,
        principalPart: 0n,
        feePart: 0n,
        toReserve: 0n,
        toLenders: 0n,
        toMerchant: p,
        repaidAfter: loan.repaid,
        remainingAfter: 0n,
        done: true,
      });
      continue;
    }
    const r = applyPayment(loan, p, repayBps);
    loan = r.loan;
    steps.push(r.step);
  }
  return { fee, owed: principal + fee, steps, loan };
}

/** Unpaid principal × 50%: what a Delinquent loan sets aside (lowers the vault value meanwhile). */
export const provisionFor = (principal: bigint, principalRepaid: bigint) =>
  ((principal - principalRepaid) * BigInt(POLICY.delinquencyProvisionBps)) / BPS;

/** Default: the reserve covers the unpaid principal first; lenders lose only the rest. */
export function defaultLoss(unpaidPrincipal: bigint, reserve: bigint) {
  const fromReserve = min(reserve, unpaidPrincipal);
  return { fromReserve, toLenders: unpaidPrincipal - fromReserve };
}

// ---------- vault (contracts/credit lib.rs, vault.rs) ----------

export const sharesForDeposit = (amount: bigint, totalShares: bigint, totalAssets: bigint) =>
  (amount * (totalShares + VIRTUAL_OFFSET)) / (totalAssets + VIRTUAL_OFFSET);

export const assetsForShares = (shares: bigint, totalShares: bigint, totalAssets: bigint) =>
  (shares * (totalAssets + VIRTUAL_OFFSET)) / (totalShares + VIRTUAL_OFFSET);

/** Share price × 1e6, as `get_vault.share_price_1e6` reports it. */
export const sharePrice1e6 = (totalShares: bigint, totalAssets: bigint) =>
  assetsForShares(1_000_000n, totalShares, totalAssets);

// ---------- underwriting (the agent's own @runway/scoring) ----------

const WEIGHTS = { stability: 35, history: 25, diversity: 15, trend: 15, corr: 10 };
const clamp01 = (v: bigint) => (v < 0n ? 0n : v > SCALE ? SCALE : v);
const frac = (v: bigint) => Number(v) / Number(SCALE);

export interface OfferEstimate {
  features: Features;
  /** points from each part of the score (they add up to the score) */
  parts: { stability: number; history: number; diversity: number; trend: number; corr: number };
  score: number;
  decision: Decision;
}

export const POLICY_FOR_SCORING = scoringPolicy({
  anchoredCaps: POLICY.anchoredCaps,
  unanchoredCaps: POLICY.unanchoredCaps,
  minLoan: POLICY.minLoan,
  maxExposurePerMerchant: POLICY.maxExposurePerMerchant,
  repayBpsMin: POLICY.repayBpsMin,
  repayBpsMax: POLICY.repayBpsMax,
});

/** Completed revenue windows (oldest first, micro-USDC) → the offer the underwriter would compute. */
export function estimateOffer(
  windows: bigint[],
  o: { repaid?: number; anchored?: boolean; statementMedian?: bigint; defaulted?: boolean } = {},
): OfferEstimate {
  const inputs = {
    buckets: windows,
    repaid: o.repaid ?? 0,
    defaulted: o.defaulted ?? false,
    frozen: false,
    anchored: o.anchored ?? false,
    statementMedian: o.statementMedian,
  };
  const f = features(inputs);
  const parts = {
    stability: WEIGHTS.stability * frac(clamp01(SCALE - f.CV)),
    history: (WEIGHTS.history * Math.min(inputs.repaid, 4)) / 4,
    diversity: f.Ctop === null ? 0 : WEIGHTS.diversity * frac(clamp01(SCALE - f.Ctop)),
    trend: WEIGHTS.trend * frac(clamp01(f.T - SCALE / 2n)),
    corr: WEIGHTS.corr * frac(f.corr),
  };
  return {
    features: f,
    parts,
    score: parts.stability + parts.history + parts.diversity + parts.trend + parts.corr,
    decision: decide(f, inputs, POLICY_FOR_SCORING),
  };
}

export const GRADE_FEE_BPS: Record<Grade, number> = { A: 400, B: 700, C: 1000 };
export const MIN_ACTIVE_WINDOWS = POLICY_FOR_SCORING.minActiveBuckets;
export const MIN_MEDIAN_REVENUE = POLICY_FOR_SCORING.minRevenue;

// ---------- revenue windows ----------

/** The 5-minute (testnet) window that `now` falls in, aligned to the clock like the contract's buckets. */
export function windowClock(nowMs: number, bucketSec = PROFILE.bucketSec) {
  const nowSec = Math.floor(nowMs / 1000);
  const index = Math.floor(nowSec / bucketSec);
  const endsAtSec = (index + 1) * bucketSec;
  return { index, startsAtSec: index * bucketSec, endsAtSec, secondsLeft: endsAtSec - nowSec };
}

export const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "12.5" → micro-USDC, tolerant of commas; null when not a number. */
export function microOf(text: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(text.replace(/,/g, "").trim());
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}
