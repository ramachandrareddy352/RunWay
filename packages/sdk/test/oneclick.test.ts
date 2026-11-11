import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getQuote,
  getTokens,
  minimumFor,
  PREVIEW_RECIPIENT,
  quoteRequest,
  USDC_NEAR_ASSET,
  verifyDeposit,
  verifyQuote,
  type Expected,
  type Quote,
} from "../src/oneclick.js";

// A live signed dry quote (5 USDC out to intents.near), captured 2026-11-11.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/oneclick-dry-quote.json", import.meta.url), "utf8"),
) as Quote;
const clone = (): Quote => structuredClone(fixture);
const expected: Expected = {
  settlement: PREVIEW_RECIPIENT,
  usdcAssetId: USDC_NEAR_ASSET,
  minOut: 5_000_000n,
  now: new Date("2026-11-11T12:40:00Z"),
  dry: true,
};
const check = (q: unknown, e: Expected, id: string) => verifyQuote(q, e).checks.find((c) => c.id === id);

describe("verifyQuote", () => {
  it("accepts the untouched dry quote, with deadline and deposit address skipped", () => {
    const r = verifyQuote(fixture, expected);
    expect(r.ok).toBe(true);
    expect(r.checks.filter((c) => c.skipped).map((c) => c.id)).toEqual(["deadline", "depositAddress"]);
  });

  it("SD5: a tampered recipient fails the signature and recipient checks", () => {
    const q = clone();
    q.quoteRequest.recipient = "attacker.near";
    expect(verifyQuote(q, expected).ok).toBe(false);
    expect(check(q, expected, "signature")?.ok).toBe(false);
    expect(check(q, expected, "recipient")?.ok).toBe(false);
  });

  it("SD5: a tampered amount fails the signature check", () => {
    const q = clone();
    q.quote.minAmountOut = "6000000";
    expect(check(q, expected, "signature")?.ok).toBe(false);
  });

  it("SD5: a deposit address injected into a dry quote is rejected (the signature doesn't cover it)", () => {
    const q = clone();
    q.quote.depositAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    // Measured: the dry-quote signature still verifies, so the address check must catch it.
    expect(check(q, expected, "signature")?.ok).toBe(true);
    expect(check(q, expected, "depositAddress")?.ok).toBe(false);
    expect(verifyQuote(q, expected).ok).toBe(false);
  });

  it("SD5: a replaced signature fails", () => {
    const q = clone();
    q.signature = "ed25519:" + "1".repeat(88);
    expect(check(q, expected, "signature")?.ok).toBe(false);
  });

  it("rejects the wrong recipient, asset, amount and dry flag even with a valid signature", () => {
    expect(check(fixture, { ...expected, settlement: "priya.pay.near" }, "recipient")?.ok).toBe(false);
    expect(
      check(fixture, { ...expected, usdcAssetId: "nep141:usdt.tether-token.near" }, "destinationAsset")?.ok,
    ).toBe(false);
    expect(check(fixture, { ...expected, minOut: 5_000_001n }, "minAmountOut")?.ok).toBe(false);
    const live = verifyQuote(fixture, { ...expected, dry: false });
    expect(live.ok).toBe(false);
    expect(live.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["dry", "deadline", "depositAddress"]);
  });

  it("never throws on garbage", () => {
    expect(verifyQuote(undefined, expected).ok).toBe(false);
    expect(verifyQuote({ quote: {}, quoteRequest: {} }, expected).ok).toBe(false);
  });

  it("builds the canonical request: EXACT_OUTPUT, USDC on NEAR, no app fees", () => {
    const req = quoteRequest(
      { dry: true, originAsset: "nep141:x", amountOut: 5_000_000n, recipient: "a.near", refundTo: "0xabc" },
      new Date("2026-11-11T00:00:00Z"),
    );
    expect(req).toMatchObject({
      swapType: "EXACT_OUTPUT",
      destinationAsset: USDC_NEAR_ASSET,
      amount: "5000000",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-11T00:15:00.000Z",
      referral: "runway",
    });
    expect(req.appFees).toBeUndefined();
  });

  it("knows the chain minimums", () => {
    expect(minimumFor("bsc")).toBe(1_000_000_000n);
    expect(minimumFor("tron")).toBe(100_000_000n);
    expect(minimumFor("base")).toBe(0n);
  });
});

describe("verifyDeposit (SD6)", () => {
  const live = (): Quote => {
    const q = clone();
    q.quoteRequest.dry = false;
    q.quote.depositAddress = "0xDEPOSIT";
    q.quote.deadline = "2026-11-11T13:00:00Z";
    return q;
  };
  const fakeFetch = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

  it("fails when the status quote points at a different deposit address", async () => {
    const r = await verifyDeposit(
      "0xOTHER",
      { ...expected, dry: false },
      {
        fetch: fakeFetch({ status: "PENDING_DEPOSIT", quoteResponse: live() }),
      },
    );
    expect(r.checks.find((c) => c.id === "status")?.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("fails when the swap already ran", async () => {
    const r = await verifyDeposit(
      "0xDEPOSIT",
      { ...expected, dry: false },
      {
        fetch: fakeFetch({ status: "SUCCESS", quoteResponse: live() }),
      },
    );
    expect(r.checks.find((c) => c.id === "status")?.detail).toContain("SUCCESS");
    expect(r.ok).toBe(false);
  });

  it("fails closed when /v0/status is unreachable", async () => {
    const r = await verifyDeposit(
      "0xDEPOSIT",
      { ...expected, dry: false },
      {
        fetch: (async () => new Response("nope", { status: 503 })) as typeof fetch,
      },
    );
    expect(r.ok).toBe(false);
  });
});

// SD4: live network test. Run with NETWORK_TESTS=1 (kept out of CI to save requests).
describe.skipIf(!process.env.NETWORK_TESTS)("SD4 live dry quote", () => {
  it("verifies end to end", async () => {
    const tokens = await getTokens();
    const base = tokens.find((t) => t.blockchain === "base" && t.symbol === "USDC");
    expect(base).toBeDefined();
    const q = await getQuote(
      quoteRequest({
        dry: true,
        originAsset: base!.assetId,
        amountOut: 5_000_000n,
        recipient: PREVIEW_RECIPIENT,
        refundTo: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      }),
    );
    expect(verifyQuote(q, { ...expected, now: new Date() }).ok).toBe(true);
  }, 30_000);
});
