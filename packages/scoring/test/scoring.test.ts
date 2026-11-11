import fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decide,
  features,
  isqrt,
  median,
  SCALE,
  score,
  window,
  type Features,
  type ScoringPolicy,
} from "../src/index.js";

const U = 1_000_000n;
const policy: ScoringPolicy = {
  anchoredCaps: [500n * U, 2_000n * U, 5_000n * U, 15_000n * U],
  unanchoredCaps: [100n * U, 250n * U, 500n * U, 1_000n * U],
  minLoan: 50n * U,
  maxExposure: 15_000n * U,
  repayBpsMin: 500,
  repayBpsMax: 2500,
  minRevenue: 300n * U,
  maxTopPayerShare: 600_000n,
  minActiveBuckets: 3,
};

interface Vectors {
  features: {
    id: string;
    features: Record<string, string | number | null>;
    merchant: { repaid: number; anchored: boolean };
    expect: Record<string, string | number>;
  }[];
  series: {
    id: string;
    buckets: string[];
    anchorIsR: boolean;
    merchant: { repaid: number; anchored: boolean };
    expect: Record<string, string | number>;
  }[];
}
const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8")) as Vectors;

const big = (v: string | number | null | undefined): bigint => BigInt(v as string);

function expectDecision(d: ReturnType<typeof decide>, e: Record<string, string | number>) {
  expect(d.kind).toBe(e.kind);
  if (d.kind === "decline") {
    expect(d.reason).toBe(e.reason);
    return;
  }
  expect(d.grade).toBe(e.grade);
  if (e.S !== undefined) expect(d.S).toBe(big(e.S));
  expect(d.limit).toBe(big(e.limit));
  expect(d.fee).toBe(big(e.fee));
  expect(d.owed).toBe(big(e.owed));
  expect(d.repayBps).toBe(e.repayBps);
}

describe("SC1: vectors", () => {
  for (const v of vectors.features) {
    it(`feature vector ${v.id}`, () => {
      const f: Features = {
        n: v.features.n as number,
        H: v.features.H as number,
        R: big(v.features.R),
        CV: big(v.features.CV),
        T: big(v.features.T),
        Ctop: v.features.Ctop === null ? null : big(v.features.Ctop),
        corr: big(v.features.corr),
      };
      expectDecision(decide(f, { ...v.merchant, defaulted: false, frozen: false }, policy), v.expect);
    });
  }
  for (const v of vectors.series) {
    it(`series vector ${v.id}`, () => {
      const buckets = v.buckets.map(BigInt);
      const R = median(window(buckets));
      const { decision } = score(
        {
          buckets,
          anchorMedian: v.anchorIsR ? R : undefined,
          ...v.merchant,
          defaulted: false,
          frozen: false,
        },
        policy,
      );
      expectDecision(decision, v.expect);
    });
  }
});

describe("SC3: edge cases", () => {
  it("window starts at the first non-zero bucket and keeps the last 6", () => {
    expect(window([0n, 0n, 1n, 2n])).toEqual([1n, 2n]);
    expect(window([1n, 2n, 3n, 4n, 5n, 6n, 7n])).toEqual([2n, 3n, 4n, 5n, 6n, 7n]);
    expect(window([0n, 0n])).toEqual([]);
  });
  it("even-length median is the floor of the two middle values", () => {
    expect(median([1n, 4n, 2n, 3n])).toBe(2n);
    expect(median([3900n, 4000n, 4000n, 4200n])).toBe(4000n);
  });
  it("isqrt floors", () => {
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(16n)).toBe(4n);
    expect(isqrt(10n ** 30n)).toBe(10n ** 15n);
  });
  it("unknown payers give zero diversity and a reason", () => {
    const d = score(
      {
        buckets: [4000n * U, 4000n * U, 4000n * U],
        repaid: 0,
        defaulted: false,
        frozen: false,
        anchored: true,
      },
      policy,
    ).decision;
    expect(d.kind).toBe("offer");
    if (d.kind === "offer") expect(d.reasons.join(" ")).toContain("diversity scored as 0");
  });
  it("payer data below 80% coverage is treated as unknown", () => {
    const buckets = [1000n * U, 1000n * U, 1000n * U];
    const f = features({
      buckets,
      payers: new Map([["a", 2000n * U]]),
      repaid: 0,
      defaulted: false,
      frozen: false,
      anchored: false,
    });
    expect(f.Ctop).toBeNull();
    const g = features({
      buckets,
      payers: new Map([
        ["a", 1500n * U],
        ["b", 1500n * U],
      ]),
      repaid: 0,
      defaulted: false,
      frozen: false,
      anchored: false,
    });
    expect(g.Ctop).toBe(500_000n);
  });
  it("trend is neutral when the earlier buckets average zero", () => {
    const f = features({
      buckets: [1n * U, 0n, 0n, 4000n * U, 4000n * U],
      repaid: 0,
      defaulted: false,
      frozen: false,
      anchored: false,
    });
    expect(f.T > SCALE).toBe(true);
    const g = features({
      buckets: [4000n * U, 4000n * U],
      repaid: 0,
      defaulted: false,
      frozen: false,
      anchored: false,
    });
    expect(g.T).toBe(SCALE);
  });
  it("declines defaulted, frozen, low revenue and too-new merchants", () => {
    const base = {
      buckets: [400n * U, 400n * U, 400n * U],
      repaid: 0,
      defaulted: false,
      frozen: false,
      anchored: true,
    };
    expect(score({ ...base, defaulted: true }, policy).decision).toMatchObject({
      kind: "decline",
      reason: "defaulted",
    });
    expect(score({ ...base, frozen: true }, policy).decision).toMatchObject({
      kind: "decline",
      reason: "frozen",
    });
    expect(score({ ...base, buckets: [100n * U, 100n * U, 100n * U] }, policy).decision).toMatchObject({
      reason: "low_revenue",
    });
    expect(score({ ...base, buckets: [400n * U, 400n * U] }, policy).decision).toMatchObject({
      reason: "too_new",
    });
  });
});

describe("SC2: properties", () => {
  const arbInputs = fc.record({
    buckets: fc.array(fc.bigInt({ min: 0n, max: 50_000n * U }), { minLength: 3, maxLength: 8 }),
    repaid: fc.integer({ min: 0, max: 6 }),
    anchored: fc.boolean(),
  });
  it("limit never exceeds caps, exposure, repayability or R × k, and terms stay in bounds", () => {
    fc.assert(
      fc.property(arbInputs, ({ buckets, repaid, anchored }) => {
        const { features: f, decision: d } = score(
          { buckets, repaid, anchored, defaulted: false, frozen: false },
          policy,
        );
        if (d.kind !== "offer") return;
        const cap = (anchored ? policy.anchoredCaps : policy.unanchoredCaps)[Math.min(repaid, 3)]!;
        expect(d.limit <= cap).toBe(true);
        expect(d.limit <= policy.maxExposure).toBe(true);
        expect(d.limit <= f.R).toBe(true);
        expect(d.limit * (10_000n + BigInt(d.feeBps)) <= 3n * f.R * 2500n).toBe(true);
        expect(d.limit >= policy.minLoan).toBe(true);
        expect(d.repayBps).toBeGreaterThanOrEqual(policy.repayBpsMin);
        expect(d.repayBps).toBeLessThanOrEqual(policy.repayBpsMax);
        expect(d.owed).toBe(d.limit + d.fee);
      }),
    );
  });
  it("SC4: deterministic", () => {
    fc.assert(
      fc.property(arbInputs, ({ buckets, repaid, anchored }) => {
        const i = { buckets, repaid, anchored, defaulted: false, frozen: false };
        expect(score(i, policy)).toEqual(score(i, policy));
      }),
    );
  });
  it("a higher repaid count never lowers the limit (same revenue)", () => {
    fc.assert(
      fc.property(arbInputs, ({ buckets, repaid, anchored }) => {
        const a = score({ buckets, repaid, anchored, defaulted: false, frozen: false }, policy).decision;
        const b = score(
          { buckets, repaid: repaid + 1, anchored, defaulted: false, frozen: false },
          policy,
        ).decision;
        if (a.kind === "offer" && b.kind === "offer") expect(b.limit >= a.limit).toBe(true);
      }),
    );
  });
});
