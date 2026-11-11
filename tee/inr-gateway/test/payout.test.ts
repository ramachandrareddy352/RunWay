import { safeLogger, SessionKeys } from "@runway/agent-kit";
import { FixedOracle } from "@runway/fx";
import { base58Encode, fromBase64, sealJson, signNep413, type Fetch } from "@runway/sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  beneficiaryMessage,
  BENEFICIARY_CONTEXT,
  GATEWAY_RECIPIENT,
  registerBeneficiary,
} from "../src/beneficiary.js";
import { openBlob, sealBlob } from "../src/blob.js";
import { payoutTick, utrHash, type PayoutDeps } from "../src/payout.js";
import { MockInrProvider } from "../src/providers/mock.js";
import { FakeGateway, IDS, MOCK_SECRET } from "./fake.js";

const blobKey = new Uint8Array(32).fill(3);

function payoutDeps(g: FakeGateway, logs: string[] = []): PayoutDeps & { provider: MockInrProvider } {
  return {
    provider: new MockInrProvider({ publicUrl: "http://gw.test", webhookSecret: MOCK_SECRET }),
    oracle: new FixedOracle(8_500),
    reader: g.reader(),
    signer: g.signer(),
    inr: IDS.inr,
    blobKey,
    log: safeLogger((l) => logs.push(l)),
  };
}

const priyaBlob = () =>
  sealBlob(blobKey, "priya.test", { fund_account_id: "mock_fa_1", masked: "pr***@upi", mode: "UPI" });

describe("payout worker", () => {
  it("pays a Pending request: start (₹ = USDC × rate) → provider → complete with sha256(UTR)", async () => {
    const g = new FakeGateway();
    g.addPayout("1", "priya.test", 82n);
    g.blobs.set("priya.test", priyaBlob());
    const d = payoutDeps(g);
    await payoutTick(d);
    const p = g.payouts.get("1")!;
    expect(p.status).toBe("Paid");
    expect(p.inr_paise).toBe("697000"); // 82 USDC × ₹85 = ₹6,970.00
    expect(p.utr_hash).toBe(utrHash("MOCKUTR1"));
    expect(d.provider.payoutCount).toBe(1);
  });

  it("fails a request with no registered beneficiary", async () => {
    const g = new FakeGateway();
    g.addPayout("1", "nobody.test", 10n);
    await payoutTick(payoutDeps(g));
    expect(g.payouts.get("1")).toMatchObject({ status: "Failed", failure_reason: "no_beneficiary" });
  });

  it("E20: a crash after start_payout resumes with the same idempotency key and pays exactly once", async () => {
    const g = new FakeGateway();
    g.addPayout("5", "priya.test", 40n);
    g.blobs.set("priya.test", priyaBlob());
    const d = payoutDeps(g);
    const created: string[] = [];
    const realCreate = d.provider.createPayout.bind(d.provider);
    let crash = true;
    d.provider.createPayout = async (i) => {
      created.push(i.idempotencyKey);
      if (crash) {
        crash = false;
        throw new Error("process killed before the provider call returned");
      }
      return realCreate(i);
    };
    await payoutTick(d); // start_payout lands, then the "crash"
    expect(g.payouts.get("5")!.status).toBe("Processing");
    await payoutTick(d); // restart: Processing → same key
    await payoutTick(d); // nothing left to do
    expect(created).toEqual(["payout-5", "payout-5"]);
    expect(d.provider.payoutCount).toBe(1);
    expect(g.payouts.get("5")!.status).toBe("Paid");
    expect(g.calls.filter((c) => c.method === "start_payout")).toHaveLength(1);
    expect(g.calls.filter((c) => c.method === "complete_payout")).toHaveLength(1);
  });
});

describe("E21: beneficiary blob", () => {
  it("round-trips, is bound to the account, and plaintext never reaches the logs", async () => {
    const b = { fund_account_id: "fa_123", masked: "pr***@okaxis", mode: "UPI" as const };
    const blob = sealBlob(blobKey, "priya.test", b);
    expect(openBlob(blobKey, "priya.test", blob)).toEqual(b);
    expect(() => openBlob(blobKey, "mallory.test", blob)).toThrow();
    expect(() => openBlob(new Uint8Array(32).fill(4), "priya.test", blob)).toThrow();

    // Full registration through the sealed endpoint, with a log snapshot.
    const g = new FakeGateway();
    const logs: string[] = [];
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 5);
    const pub = `ed25519:${base58Encode(ed25519.getPublicKey(seed))}`;
    const fetchKeys: Fetch = async (_url, init) => {
      const p = JSON.parse(init.body) as { params: { public_key?: string } };
      const result =
        p.params.public_key === pub ? { permission: "FullAccess", nonce: 1 } : { error: "no such key" };
      return { ok: true, status: 200, json: async () => ({ result }) };
    };
    const session = new SessionKeys(g.signer());
    const s = await session.rotate();
    const auth = signNep413(
      { message: beneficiaryMessage("priya.test"), recipient: GATEWAY_RECIPIENT },
      "priya.test",
      `ed25519:${base58Encode(seed)}`,
    );
    const { sealed } = sealJson(
      {
        type: "vpa",
        nep413_auth: auth,
        account_id: "priya.test",
        name: "Priya Sharma",
        vpa: "priya.sharma@okaxis",
      },
      s.keypair.publicKey,
      BENEFICIARY_CONTEXT,
    );
    const r = await registerBeneficiary(sealed, {
      session,
      provider: new MockInrProvider({ publicUrl: "http://gw.test", webhookSecret: MOCK_SECRET }),
      signer: g.signer(),
      rpc: { rpcs: ["http://fake"], fetch: fetchKeys },
      seenNonces: new Set<string>(),
      blobKey,
      log: safeLogger((l) => logs.push(l)),
    });
    expect(r).toEqual({ ok: true, masked: "pr***@okaxis" });
    const stored = openBlob(blobKey, "priya.test", g.blobs.get("priya.test")!);
    expect(stored.masked).toBe("pr***@okaxis");
    expect(fromBase64(g.blobs.get("priya.test")!).length).toBeGreaterThan(40);
    const all = logs.join("\n") + JSON.stringify(g.calls);
    for (const secret of ["priya.sharma@okaxis", "Priya Sharma", auth.signature])
      expect(all).not.toContain(secret);
  });
});
