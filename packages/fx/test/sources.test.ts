// SP13 source parsers, on response shapes captured live on 2026-11-11.
import { describe, expect, it } from "vitest";
import { coinDcxSource, giottusSource, wazirxSource } from "../src/sources.js";

const respond = (body: unknown) =>
  (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
const signal = new AbortController().signal;

describe("SP13 sources", () => {
  it("CoinDCX USDCINR", async () => {
    const f = respond([
      { market: "BTCINR", last_price: "1", timestamp: 1 },
      { market: "USDCINR", last_price: "100.1770600000", timestamp: 1794406489 },
    ]);
    expect(await coinDcxSource(f).read(signal)).toEqual({
      name: "coindcx:USDCINR",
      ratePpu: 10_017,
      at: 1_794_406_489_000,
    });
  });

  it("WazirX usdcinr", async () => {
    const f = respond({ symbol: "usdcinr", lastPrice: "99.5", at: 1794406513000 });
    expect(await wazirxSource(f).read(signal)).toMatchObject({ ratePpu: 9_950, at: 1_794_406_513_000 });
  });

  it("Giottus usdtinr", async () => {
    const f = respond({
      usdtinr: { last: "99.73", at: 1794406519 },
      usdcinr: { last: "97", at: 1794406519 },
    });
    expect(await giottusSource(f).read(signal)).toMatchObject({ ratePpu: 9_973, at: 1_794_406_519_000 });
  });

  it("fails on missing markets and HTTP errors", async () => {
    await expect(coinDcxSource(respond([])).read(signal)).rejects.toThrow("not listed");
    const err = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    await expect(wazirxSource(err).read(signal)).rejects.toThrow("HTTP 429");
  });
});
