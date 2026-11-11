import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FixedOracle,
  formatInr,
  inrPriceToPpu,
  inrToUsdc,
  medianInt,
  MultiSourceOracle,
  usdcToInr,
  type RateSource,
} from "../src/index.js";

describe("SC5: conversion vectors identical to runway_shared::fx", () => {
  it("matches the Rust results", () => {
    expect(inrToUsdc(100_000n, 9_600, 50)).toBe(10_364_583n); // ₹1,000 at ₹96, 50 bps
    expect(usdcToInr(105_600_000n, 9_600, 50)).toBe(1_008_691n); // 105.60 USDC → ₹10,086.91
    expect(inrToUsdc(850_000n, 8_500, 0)).toBe(100_000_000n); // ₹8,500 at ₹85 → 100 USDC
  });
  it("matches the demo numbers (T4b.10)", () => {
    expect(usdcToInr(82_160_000n, 8_500, 0)).toBe(698_360n); // 82.16 USDC → ₹6,983.60
  });
});

describe("E25: FX rounding", () => {
  it("floors, so a round trip never gains", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 13n }),
        fc.integer({ min: 7_000, max: 13_000 }),
        fc.integer({ min: 0, max: 200 }),
        (paise, rate, spread) => {
          const usdc = inrToUsdc(paise, rate, spread);
          expect(usdcToInr(usdc, rate, 0)).toBeLessThanOrEqual(paise);
          expect(usdc).toBeGreaterThanOrEqual(0n);
        },
      ),
    );
  });
  it("rejects bad inputs", () => {
    expect(() => inrToUsdc(1n, 0, 0)).toThrow();
    expect(() => inrToUsdc(1n, 8_500.5, 0)).toThrow();
    expect(() => usdcToInr(-1n, 8_500, 0)).toThrow();
    expect(() => usdcToInr(1n, 8_500, 10_000)).toThrow();
  });
  it("parses decimal prices to integer paise (floor)", () => {
    expect(inrPriceToPpu("85.1299")).toBe(8_512);
    expect(inrPriceToPpu("96")).toBe(9_600);
    expect(inrPriceToPpu(84.5)).toBe(8_450);
    expect(() => inrPriceToPpu("-1")).toThrow();
  });
  it("formats rupees with Indian grouping", () => {
    expect(formatInr(698_360n)).toBe("₹6,983.60");
    expect(formatInr(1_000_000_000n)).toBe("₹1,00,00,000.00");
    expect(formatInr(5n)).toBe("₹0.05");
  });
});

const NOW = 1_800_000_000_000;
const src = (name: string, ratePpu: number, ageMs = 0, fail = false): RateSource => ({
  name,
  read: async () => {
    if (fail) throw new Error("down");
    return { name, ratePpu, at: NOW - ageMs };
  },
});

describe("E19: multi-source oracle", () => {
  it("drops a stale and a divergent source and uses the median of the rest", async () => {
    const o = new MultiSourceOracle(
      [src("a", 8_500), src("b", 8_510), src("c", 8_505), src("stale", 8_500, 120_000), src("far", 9_000)],
      { now: () => NOW },
    );
    const r = await o.read();
    expect(r.paused).toBe(false);
    expect(r.ratePpu).toBe(8_505);
    expect(r.dropped.map((d) => d.name).sort()).toEqual(["far", "stale"]);
  });

  it("pauses when fewer than 2 sources agree", async () => {
    const o = new MultiSourceOracle([src("a", 8_500), src("far", 9_000), src("down", 0, 0, true)], {
      now: () => NOW,
    });
    const r = await o.read();
    expect(r.paused).toBe(true);
    expect(r.ratePpu).toBe(0);
    expect(r.reason).toMatch(/agree|fresh/);
  });

  it("times out slow sources", async () => {
    const slow: RateSource = { name: "slow", read: () => new Promise(() => {}) };
    const o = new MultiSourceOracle([slow, src("a", 8_500), src("b", 8_502)], {
      now: () => NOW,
      timeoutMs: 20,
    });
    const r = await o.read();
    expect(r.paused).toBe(false);
    expect(r.dropped).toEqual([{ name: "slow", reason: "error: timeout" }]);
  });

  it("caches for 15 s", async () => {
    let t = NOW;
    let calls = 0;
    const counting: RateSource = {
      name: "c",
      read: async () => (calls++, { name: "c", ratePpu: 8_500, at: t }),
    };
    const o = new MultiSourceOracle([counting, src("b", 8_500)], { now: () => t, maxAgeMs: 10 ** 12 });
    await o.read();
    t += 10_000;
    await o.read();
    expect(calls).toBe(1);
    t += 6_000;
    await o.read();
    expect(calls).toBe(2);
  });

  it("FixedOracle returns its rate", async () => {
    expect((await new FixedOracle(8_500).read()).ratePpu).toBe(8_500);
  });

  it("medianInt floors even counts", () => {
    expect(medianInt([1, 2])).toBe(1);
    expect(medianInt([3, 1, 2])).toBe(2);
  });
});
