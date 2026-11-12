import { describe, expect, it } from "vitest";
import { failover, rpcUnavailable, viewAgreed, type Fetch } from "../src/index.js";

// Shaped like near-api-js errors: ProviderError carries the HTTP status in `cause`, TypedError a `type`.
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { cause: status });
const typed = (type: string) => Object.assign(new Error(type), { type });

describe("rpcUnavailable", () => {
  it("is true for rate limits, server errors, timeouts and network failures", () => {
    for (const e of [
      http(429),
      http(503),
      http(408),
      typed("RetriesExceeded"),
      new TypeError("fetch failed"),
    ])
      expect(rpcUnavailable(e)).toBe(true);
    expect(rpcUnavailable(new Error('{"code":-429,"message":"Rate limits exceeded"}'))).toBe(true);
  });

  it("is false for answers from the chain", () => {
    for (const e of [http(400), typed("InvalidNonce"), typed("Expired"), typed("AccountDoesNotExist")])
      expect(rpcUnavailable(e)).toBe(false);
  });
});

describe("failover", () => {
  const client = (name: string, fail?: Error) => {
    const calls: string[] = [];
    return {
      calls,
      async query(x: string) {
        calls.push(x);
        if (fail) throw fail;
        return `${name}:${x}`;
      },
    };
  };

  it("moves to the next RPC on HTTP 429 and keeps using it", async () => {
    const a = client("a", http(429));
    const b = client("b");
    const p = failover([a, b]);
    expect(await p.query("1")).toBe("b:1");
    expect(await p.query("2")).toBe("b:2");
    expect(a.calls).toEqual(["1"]);
  });

  it("passes chain errors through unchanged, so near-api-js can retry InvalidNonce itself", async () => {
    const nonce = typed("InvalidNonce");
    const a = client("a", nonce);
    const b = client("b");
    await expect(failover([a, b]).query("1")).rejects.toBe(nonce);
    expect(b.calls).toEqual([]);
  });

  it("throws the last error when every RPC is unavailable", async () => {
    const last = http(503);
    await expect(failover([client("a", http(429)), client("b", last)]).query("1")).rejects.toBe(last);
  });
});

describe("verified reads retry an unavailable RPC", () => {
  const ok = (value: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } }),
  });

  it("retries after HTTP 429 and returns the answer", async () => {
    let calls = 0;
    const fetch: Fetch = async () =>
      ++calls === 1 ? { ok: false, status: 429, json: async () => ({}) } : ok(7);
    expect(await viewAgreed<number>("c.testnet", "m", {}, { rpcs: ["https://a"], fetch })).toBe(7);
    expect(calls).toBe(2);
  });

  it("does not retry an error the chain returned", async () => {
    let calls = 0;
    const fetch: Fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ error: { message: "UNKNOWN_ACCOUNT" } }) };
    };
    await expect(viewAgreed("c.testnet", "m", {}, { rpcs: ["https://a"], fetch })).rejects.toThrow(
      "UNKNOWN_ACCOUNT",
    );
    expect(calls).toBe(1);
  });
});
