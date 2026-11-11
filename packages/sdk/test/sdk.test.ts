import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  base58Decode,
  base58Encode,
  completeBuckets,
  nep413Hash,
  RpcDisagreement,
  verifyNep413,
  verifySignature,
  viewAgreed,
  type Fetch,
  type SignedMessage,
} from "../src/index.js";

function signed(overrides: Partial<SignedMessage> = {}, nonceTs = Date.now()) {
  const sk = ed25519.utils.randomSecretKey();
  const pk = ed25519.getPublicKey(sk);
  const nonce = Buffer.alloc(32);
  nonce.writeBigUInt64BE(BigInt(nonceTs), 0);
  const base = { message: "runway-underwrite:priya", nonce, recipient: "runway-underwriter" };
  const sig = ed25519.sign(nep413Hash(base), sk);
  const m: SignedMessage = {
    accountId: "priya.testnet",
    publicKey: `ed25519:${base58Encode(pk)}`,
    signature: Buffer.from(sig).toString("base64"),
    message: base.message,
    nonce: nonce.toString("base64"),
    recipient: base.recipient,
    ...overrides,
  };
  return m;
}

/** Fake RPCs: `perUrl[url]` gives the access-key permission or call_function result for that provider. */
function fakeFetch(
  perUrl: Record<string, { permission?: unknown; result?: unknown; height?: number }>,
): Fetch {
  return async (url, init) => {
    const req = JSON.parse(init.body) as { method: string; params: { request_type?: string } };
    const p = perUrl[url]!;
    let result: unknown;
    if (req.method === "block") result = { header: { height: p.height ?? 100 } };
    else if (req.params.request_type === "view_access_key")
      result = { nonce: 1, permission: p.permission, block_height: 1 };
    else result = { result: [...Buffer.from(JSON.stringify(p.result))], block_height: 1 };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: "runway", result }) };
  };
}

describe("base58", () => {
  it("round-trips, including leading zeros", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255, 7]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });
});

describe("SD1: NEP-413 signature", () => {
  it("verifies a correct signature and rejects tampering", () => {
    const m = signed();
    expect(verifySignature(m)).toBe(true);
    expect(verifySignature({ ...m, message: "something else" })).toBe(false);
    expect(verifySignature({ ...m, recipient: "evil" })).toBe(false);
  });
});

describe("SD2: full NEP-413 check", () => {
  const rpcs = ["https://a", "https://b"];
  const full = fakeFetch({
    "https://a": { permission: "FullAccess" },
    "https://b": { permission: "FullAccess" },
  });

  it("accepts a FullAccess key once, then rejects the reused nonce", async () => {
    const m = signed();
    const seen = new Set<string>();
    const o = {
      expectedRecipient: "runway-underwriter",
      seenNonces: seen,
      maxAgeMs: 300_000,
      rpc: { rpcs, fetch: full },
    };
    expect(await verifyNep413(m, o)).toEqual({ ok: true });
    expect(await verifyNep413(m, o)).toEqual({ ok: false, reason: "nonce reused" });
  });

  it("rejects a key that is not a FullAccess key of the account (impersonation)", async () => {
    const fc = fakeFetch({
      "https://a": { permission: { FunctionCall: { allowance: null, receiver_id: "x", method_names: [] } } },
      "https://b": { permission: { FunctionCall: { allowance: null, receiver_id: "x", method_names: [] } } },
    });
    const r = await verifyNep413(signed(), {
      expectedRecipient: "runway-underwriter",
      seenNonces: new Set(),
      rpc: { rpcs, fetch: fc },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects wrong recipient and stale nonce", async () => {
    const o = {
      expectedRecipient: "runway-underwriter",
      seenNonces: new Set<string>(),
      maxAgeMs: 300_000,
      rpc: { rpcs, fetch: full },
    };
    expect((await verifyNep413(signed({ recipient: "other" }), o)).ok).toBe(false);
    expect(await verifyNep413(signed({}, Date.now() - 3_600_000), o)).toEqual({
      ok: false,
      reason: "stale nonce",
    });
  });
});

describe("SD3: dual-RPC agreement", () => {
  it("returns the agreed value and throws on disagreement", async () => {
    const same = fakeFetch({
      "https://a": { result: { x: 1 }, height: 105 },
      "https://b": { result: { x: 1 }, height: 100 },
    });
    expect(await viewAgreed("c", "m", {}, { rpcs: ["https://a", "https://b"], fetch: same })).toEqual({
      x: 1,
    });
    const diff = fakeFetch({ "https://a": { result: { x: 1 } }, "https://b": { result: { x: 2 } } });
    await expect(
      viewAgreed("c", "m", {}, { rpcs: ["https://a", "https://b"], fetch: diff }),
    ).rejects.toBeInstanceOf(RpcDisagreement);
  });
});

describe("completeBuckets", () => {
  it("fills gaps with zeros and drops the current bucket", () => {
    const b = [
      { bucket: "10", inflow: "5" },
      { bucket: "12", inflow: "7" },
      { bucket: "13", inflow: "9" },
    ];
    expect(completeBuckets(b, 13n)).toEqual([5n, 0n, 7n]);
    expect(completeBuckets(b, 10n)).toEqual([]);
  });
});
