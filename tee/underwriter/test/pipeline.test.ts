import { usdc } from "@runway/config";
import { describe, expect, it } from "vitest";
import { verifyCommitment } from "../src/commit.js";
import { sanitizeFields } from "@runway/agent-kit";
import { bucketRevenue, inrReceipts } from "../src/revenue.js";
import { RequestRejected, underwrite } from "../src/underwrite.js";
import { deps, merchantViews, nearKey, PRIYA, signedRequest, SETTLEMENT } from "./helpers.js";

describe("underwrite pipeline", () => {
  it("makes an anchored grade C offer from six steady buckets and commits to its inputs (E6)", async () => {
    const { d, key, captured } = deps();
    const r = await underwrite({ handle: "priya", nep413: signedRequest(key.secret) }, d);
    expect(r.decision).toBe("offer");
    expect(r.terms).toMatchObject({ grade: "C", limit: String(usdc(500)), fee_bps: 1000 });
    const call = captured.calls.find((c) => c.method === "submit_offer")!;
    expect(call.args).toMatchObject({ handle: "priya", grade: "C", policy_version: 1 });
    // Expiry is chain time + offer TTL (the sandbox runs ahead of the wall clock).
    expect(call.args.expires_at_sec).toBe(String(1_800_000_000 + 600));
    // E6: the merchant can recompute the on-chain commitment from the sealed {inputs, salt}.
    expect(verifyCommitment(String(call.args.inputs_commitment), r.inputs, r.salt)).toBe(true);
    expect(verifyCommitment(String(call.args.inputs_commitment), { ...r.inputs, repaid: 9 }, r.salt)).toBe(
      false,
    );
    expect(r.reasons.join("\n")).toContain("sandbox fixture");
  });

  it("declines a merchant with too little history and writes nothing on-chain", async () => {
    const { d, key, captured } = deps({ scenario: { buckets: [4_000, 4_000] } });
    const r = await underwrite({ handle: "priya", nep413: signedRequest(key.secret) }, d);
    expect(r.decision).toBe("decline");
    expect(captured.calls).toHaveLength(0);
  });

  it("E3: an impostor's NEP-413 is rejected", async () => {
    const mallory = nearKey(9);
    // Signs as Mallory: not the payout account.
    const { d } = deps({
      chain: {
        keys: new Map([
          [PRIYA, [nearKey(1).public]],
          ["mallory.test", [mallory.public]],
        ]),
      },
    });
    await expect(
      underwrite({ handle: "priya", nep413: signedRequest(mallory.secret, "mallory.test") }, d),
    ).rejects.toThrow("signer is not the merchant's payout account");
    // Claims to be Priya with a key that isn't one of Priya's FullAccess keys.
    const { d: d2 } = deps();
    await expect(
      underwrite({ handle: "priya", nep413: signedRequest(mallory.secret) }, d2),
    ).rejects.toBeInstanceOf(RequestRejected);
    // A replayed nonce.
    const { d: d3, key } = deps();
    const once = signedRequest(key.secret);
    await underwrite({ handle: "priya", nep413: once }, d3);
    await expect(underwrite({ handle: "priya", nep413: once }, d3)).rejects.toThrow("nonce reused");
    // Signed for another handle.
    await expect(
      underwrite({ handle: "priya", nep413: signedRequest(key.secret, PRIYA, "other") }, d3),
    ).rejects.toThrow("does not match");
  });

  it("E4: an RPC disagreement aborts", async () => {
    const base = merchantViews();
    const { d, key, captured } = deps({
      chain: {
        view: (c, m, a, url) => {
          const v = base(c, m, a, url);
          // RPC b reports a bigger bucket than RPC a.
          if (c === SETTLEMENT && m === "get_buckets" && url === "http://rpc-b")
            return (v as { bucket: string; inflow: string }[]).map((b) => ({
              ...b,
              inflow: String(usdc(9_000)),
            }));
          return v;
        },
      },
    });
    await expect(underwrite({ handle: "priya", nep413: signedRequest(key.secret) }, d)).rejects.toThrow(
      "disagree",
    );
    expect(captured.calls).toHaveLength(0);
  });

  it("E9: an anchor reused by another handle is rejected by the contract and surfaces as an error", async () => {
    const { d, key } = deps();
    d.signer = {
      accountId: () => "agent.test",
      call: async () => {
        throw new Error("Smart contract panicked: ERR_ANCHOR_TAKEN");
      },
    };
    await expect(underwrite({ handle: "priya", nep413: signedRequest(key.secret) }, d)).rejects.toThrow(
      "ERR_ANCHOR_TAKEN",
    );
  });

  it("E7: no plaintext evidence in logs", async () => {
    const logs: string[] = [];
    const stripeKey = "rk_test_SECRETSECRETSECRET123";
    const { d, key } = deps({
      logs,
      fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
    });
    const nep413 = signedRequest(key.secret);
    await underwrite(
      {
        handle: "priya",
        nep413,
        stripe_key: stripeKey,
        statements: [
          {
            name: "jan.csv",
            mime: "text/csv",
            data_b64: Buffer.from("date,amount\n2026-01-03,4200").toString("base64"),
          },
        ],
      },
      d,
    );
    const all = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [stripeKey, nep413.signature, nep413.publicKey, "4200", "2026-01-03"])
      expect(all).not.toContain(secret);
    expect(
      sanitizeFields({ handle: "priya", stripe_key: stripeKey, reason: "has spaces and secrets" }),
    ).toEqual({
      handle: "priya",
      stripe_key: "[redacted-key]",
      reason: "[redacted]",
    });
  });
});

describe("E26: INR receipts", () => {
  const receipt = (status: string, at: number, delivered: number, payer: string | null = "PayerHash1") => ({
    kind: { type: "merchant_sale", handle: "priya" },
    inr_paise: "850000",
    rate_ppu: 8500,
    spread_bps: 0,
    usdc: String(usdc(delivered)),
    delivered: String(usdc(delivered)),
    payer_ref_hash: payer,
    at_sec: at,
    status,
  });

  it("counts Delivered sales by bucket, ignores Failed ones and the current bucket, and labels simulated UPI", () => {
    const rs = [
      ["h1", receipt("Delivered", 300 * 7 + 5, 100)],
      ["h2", receipt("Failed", 300 * 7 + 6, 0)],
      ["h3", receipt("Delivered", 300 * 8 + 1, 50, null)],
      ["h4", receipt("Delivered", 300 * 10 + 1, 70)], // current bucket
    ] as [string, never][];
    const r = inrReceipts(rs, 300n, 10n, true);
    expect([...r.perBucket]).toEqual([
      [7n, usdc(100)],
      [8n, usdc(50)],
    ]);
    expect(r.summary).toMatchObject({ delivered: 2, ignored: 2, simulated: true });
    expect([...r.payers]).toEqual([["upi:PayerHash1", usdc(100)]]);
    const rev = bucketRevenue({
      source: "testnet-buckets",
      raw: [],
      currentBucket: 10n,
      bucketSec: 300n,
      receipts: rs,
    });
    expect(rev.labels.join(" ")).toContain("2 UPI receipts (simulated UPI)");
  });

  it("flows into the pipeline's reasons and payer map", async () => {
    const { d, key } = deps({
      scenario: { inrReceipts: [["h1", receipt("Delivered", 300 * 8, 100)]] },
    });
    const r = await underwrite({ handle: "priya", nep413: signedRequest(key.secret) }, d);
    expect(r.reasons.join("\n")).toContain("1 UPI receipt (simulated UPI)");
    expect(r.inputs.payers).toEqual([["upi:PayerHash1", String(usdc(100))]]);
  });
});
