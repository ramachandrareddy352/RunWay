// The previews must reproduce the contracts' integer maths and the underwriter's scoring exactly.
// Expected values are worked out by hand from contracts/credit (router.rs, loans.rs, lib.rs),
// contracts/settlement and @runway/scoring.
import { describe, expect, it } from "vitest";
import {
  applyPayment,
  assetsForShares,
  defaultLoss,
  drawTerms,
  estimateOffer,
  microOf,
  periodRequirement,
  provisionFor,
  sharePrice1e6,
  sharesForDeposit,
  simulateLoan,
  splitPayment,
  windowClock,
} from "../lib/sim";

const u = (n: number) => BigInt(Math.round(n * 1_000_000));

describe("payment split", () => {
  it("takes floor(inflow × repay_bps / 10,000) while a loan is open", () => {
    expect(splitPayment(u(400), 917)).toEqual({ repay: u(36.68), merchant: u(363.32) });
    expect(splitPayment(u(99.5), 917)).toEqual({ repay: 9_124_150n, merchant: 90_375_850n });
  });
  it("takes nothing without a loan", () => {
    expect(splitPayment(u(400), null)).toEqual({ repay: 0n, merchant: u(400) });
  });
});

describe("loan accounting (apply_regular)", () => {
  it("splits each repayment into principal and fee, 10% of the fee to the reserve", () => {
    const loan = { principal: u(100), owed: u(110), repaid: 0n, principalRepaid: 0n };
    const a = applyPayment(loan, u(400), 917);
    expect(a.step).toMatchObject({
      applied: u(36.68),
      principalPart: 33_345_454n,
      feePart: 3_334_546n,
      toReserve: 333_454n,
      toMerchant: u(363.32),
      remainingAfter: u(73.32),
      done: false,
    });
    const b = applyPayment(a.loan, u(99.5), 917);
    expect(b.step).toMatchObject({ applied: 9_124_150n, principalPart: 8_294_682n, toReserve: 82_946n });
    const c = applyPayment(b.loan, u(1200), 917);
    expect(c.step).toMatchObject({
      repayPart: u(110.04),
      applied: 64_195_850n,
      principalPart: 58_359_864n,
      toReserve: 583_598n,
      toMerchant: 1_135_804_150n,
      done: true,
    });
    // The whole fee of 10: 9.000002 to lenders, 0.999998 to the reserve.
    const reserve = a.step.toReserve + b.step.toReserve + c.step.toReserve;
    expect(reserve).toBe(999_998n);
    const toCash = a.step.toLenders + b.step.toLenders + c.step.toLenders;
    expect(toCash - u(100)).toBe(9_000_002n);
  });

  it("never takes more than is owed; later payments go to the merchant in full", () => {
    const r = simulateLoan(u(100), 1000, 917, [u(1200), u(400)]);
    expect(r.steps[0]).toMatchObject({ applied: u(110), toMerchant: u(1090), done: true });
    expect(r.steps[1]).toMatchObject({ applied: 0n, toMerchant: u(400) });
  });

  it("scales the repay share when drawing less than the limit", () => {
    expect(drawTerms({ limit: u(100), feeBps: 1000, repayBps: 917 }, u(100))).toEqual({
      repayBps: 917,
      fee: u(10),
      owed: u(110),
    });
    expect(drawTerms({ limit: u(100), feeBps: 1000, repayBps: 917 }, u(60)).repayBps).toBe(551);
    expect(drawTerms({ limit: u(100), feeBps: 1000, repayBps: 600 }, u(50)).repayBps).toBe(500);
  });

  it("requires 10% of the owed amount per period, provisions 50% when delinquent", () => {
    expect(periodRequirement(u(110))).toBe(u(11));
    expect(periodRequirement(u(110), u(5))).toBe(u(5));
    expect(provisionFor(u(100), 0n)).toBe(u(50));
    expect(defaultLoss(u(100), u(30))).toEqual({ fromReserve: u(30), toLenders: u(70) });
  });
});

describe("vault shares", () => {
  it("mints and redeems at (assets + 1) / (shares + 1)", () => {
    expect(sharesForDeposit(u(10_000), 0n, 0n)).toBe(u(10_000));
    expect(sharePrice1e6(u(10_000), 10_009_000_002n)).toBe(1_000_899n);
    expect(assetsForShares(u(1_000), u(10_000), 10_009_000_002n)).toBe(1_000_899_910n);
    // The live testnet deposit of 200 USDC at price 1.000899 minted 199.820179 shares.
    expect(sharesForDeposit(u(200), u(10_000), 10_009_000_002n)).toBe(199_820_179n);
  });
});

describe("offer estimate (the underwriter's scoring)", () => {
  it("three equal 400 USDC windows: grade C, limit 100, fee 10%, repay share 9.17%", () => {
    const e = estimateOffer([u(400), u(400), u(400)]);
    expect(e.score).toBeCloseTo(42.5, 5);
    expect(e.decision).toMatchObject({
      kind: "offer",
      grade: "C",
      limit: u(100),
      feeBps: 1000,
      repayBps: 917,
    });
  });
  it("declines a merchant with fewer than 3 windows", () => {
    expect(estimateOffer([u(400), u(400)]).decision).toMatchObject({ kind: "decline", reason: "too_new" });
  });
  it("declines unsteady revenue (an empty window after the payments)", () => {
    const e = estimateOffer([u(400), u(400), u(400), 0n]);
    expect(e.decision).toMatchObject({ kind: "decline", reason: "low_score" });
  });
  it("declines a median below 300 USDC", () => {
    expect(estimateOffer([u(100), u(100), u(100)]).decision).toMatchObject({ reason: "low_revenue" });
  });
});

describe("helpers", () => {
  it("aligns windows to the clock", () => {
    const w = windowClock(Date.UTC(2026, 10, 13, 10, 7, 30), 300);
    expect(w.secondsLeft).toBe(150);
  });
  it("parses amounts", () => {
    expect(microOf("1,200.5")).toBe(u(1200.5));
    expect(microOf("abc")).toBeNull();
  });
});
