import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { FixedOracle } from "@runway/fx";
import { concatBytes, fromHex, fromUtf8, toHex, utf8, type Status } from "@runway/sdk";
import { describe, expect, it } from "vitest";
import { localKeySource, type AppKeySource } from "@runway/agent-kit";
import {
  checkChatSignature,
  EvidenceRejected,
  expectedMrConfigId,
  NearAi,
  recoverEip191,
  replayRtmr3,
  verifyAttestation,
  type QuoteVerifier,
} from "../src/nearai.js";
import { razorpayAnchor } from "../src/razorpay-anchor.js";
import { checkDelivery, verifiedRevenue } from "../src/revenue.js";
import { checkStripeKey, stripeAnchor, StripeKeyRejected } from "../src/stripe.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// ---------- Stripe (E8, E10) ----------

function stripeFetch(accountId: string) {
  return (async (url: string) => {
    if (url.endsWith("/v1/account")) return json({ id: accountId });
    return json({
      data: [
        { id: "txn_1", net: 400_000, currency: "usd", created: 300 * 7 + 1 }, // $4,000.00 in bucket 7
        { id: "txn_2", net: 420_000, currency: "usd", created: 300 * 8 + 1 },
        { id: "txn_3", net: 99_999, currency: "eur", created: 300 * 8 + 2 },
      ],
      has_more: false,
    });
  }) as unknown as typeof fetch;
}

const stripeOpts = (kApp: Uint8Array, accountId = "acct_1ABCdef") => ({
  network: "testnet" as const,
  base: "https://api.stripe.com",
  kApp,
  windowStartSec: 0,
  bucketSec: 300,
  currentBucket: 10n,
  fetch: stripeFetch(accountId),
});

describe("Stripe anchor", () => {
  it("E8: anchors are deterministic across restarts (same app key) and differ per account", async () => {
    const restartA: AppKeySource = localKeySource("app-key-seed-0123456789");
    const restartB: AppKeySource = localKeySource("app-key-seed-0123456789");
    const k1 = await restartA.appKey("runway/anchor/v1");
    const k2 = await restartB.appKey("runway/anchor/v1");
    const a = await stripeAnchor("rk_test_abcdefghij123", stripeOpts(k1));
    const b = await stripeAnchor("rk_test_abcdefghij123", stripeOpts(k2));
    const other = await stripeAnchor("rk_test_abcdefghij123", stripeOpts(k1, "acct_2XYZabc"));
    expect(a.anchorHash).toBe(b.anchorHash);
    expect(other.anchorHash).not.toBe(a.anchorHash);
    // $4,000 and $4,200 → median 4,100 USDC; the EUR row is ignored with a note.
    expect(a.medianPerBucket).toBe(4_100_000_000n);
    expect(a.notes.join(" ")).toContain("EUR");
    expect(a.notes).toContain("Stripe test mode, not real KYC");
  });

  it("E10: a live key on testnet is accepted, a test key on mainnet is rejected", () => {
    expect(checkStripeKey("rk_live_abcdefghij123", "testnet")).toEqual({ testMode: false });
    expect(() => checkStripeKey("rk_test_abcdefghij123", "mainnet")).toThrow(StripeKeyRejected);
    expect(() => checkStripeKey("sk_live_abcdefghij123", "testnet")).toThrow(StripeKeyRejected);
  });
});

describe("E27: Razorpay anchor", () => {
  it("is deterministic per account and converts settlements at the oracle rate", async () => {
    const kApp = await localKeySource("app-key-seed-0123456789").appKey("runway/anchor/v1");
    const f = (async () =>
      json({
        items: [{ id: "setl_1", amount: 34_000_000, status: "processed", created_at: 300 * 7 }],
      })) as unknown as typeof fetch;
    const o = {
      network: "testnet" as const,
      base: "https://api.razorpay.com",
      kApp,
      oracle: new FixedOracle(8_500),
      spreadBps: 0,
      windowStartSec: 0,
      bucketSec: 300,
      currentBucket: 10n,
      fetch: f,
    };
    const a = await razorpayAnchor(
      { keyId: "rzp_test_abcdef", keySecret: "s", accountId: "acc_ABCDEF123" },
      o,
    );
    const b = await razorpayAnchor(
      { keyId: "rzp_test_abcdef", keySecret: "s", accountId: "acc_ABCDEF123" },
      o,
    );
    expect(a.anchorHash).toBe(b.anchorHash);
    expect(a.medianPerBucket).toBe(4_000_000_000n); // ₹3,40,000 at ₹85 = 4,000 USDC
    // Reuse by another handle is refused on-chain (ERR_ANCHOR_TAKEN, contract test C8).
    await expect(
      razorpayAnchor(
        { keyId: "rzp_test_abcdef", keySecret: "s", accountId: "acc_ABCDEF123" },
        { ...o, network: "mainnet" },
      ),
    ).rejects.toThrow("test-mode keys");
  });
});

// ---------- 1Click-verified revenue (E5) ----------

const dryQuote = JSON.parse(
  readFileSync(
    new URL("../../../packages/sdk/test/fixtures/oneclick-dry-quote.json", import.meta.url),
    "utf8",
  ),
) as Status["quoteResponse"];

function status(over: {
  depositAddress?: string;
  status?: string;
  amountOut?: string;
  tamper?: boolean;
}): Status {
  const quoteResponse = structuredClone(dryQuote);
  // A dry quote's signature doesn't cover depositAddress (SPIKES SP16), which lets the fixture stand
  // in for a delivered quote here; the live pay page rejects dry quotes that carry one.
  quoteResponse.quote.depositAddress = over.depositAddress ?? "dep-1";
  if (over.tamper) quoteResponse.quote.amountOut = "1";
  return {
    correlationId: "c",
    status: (over.status ?? "SUCCESS") as Status["status"],
    updatedAt: new Date(300 * 7 * 1000 + 5_000).toISOString(),
    quoteResponse,
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      amountOut: over.amountOut ?? "1000000",
      originChainTxHashes: [],
      destinationChainTxHashes: [],
    },
  } as unknown as Status;
}

describe("E5: verified revenue", () => {
  const settlement = dryQuote.quoteRequest.recipient;

  it("counts a verified delivery and excludes unverifiable ones with a reason", async () => {
    const statuses: Record<string, Status> = {
      "dep-1": status({}),
      "dep-2": status({ depositAddress: "dep-2", tamper: true }),
      "dep-3": status({ depositAddress: "dep-3", status: "PROCESSING" }),
    };
    const r = await verifiedRevenue({
      settlement,
      payments: [
        { depositAddress: "dep-1" },
        { depositAddress: "dep-2" },
        { depositAddress: "dep-3" },
        { depositAddress: "dep-9" },
      ],
      status: async (a) => {
        const s = statuses[a];
        if (!s) throw new Error("404");
        return s;
      },
      raw: [{ bucket: "7", inflow: "5000000" }],
      currentBucket: 10n,
      bucketSec: 300n,
      receipts: [],
    });
    expect(r.buckets).toEqual([1_000_000n, 0n, 0n]);
    expect(r.excluded.map((e) => [e.ref, e.reason.split(":")[0]])).toEqual([
      ["dep-2", "signature"],
      ["dep-3", "status PROCESSING"],
      ["dep-9", "status unavailable"],
    ]);
  });

  it("never counts more than the on-chain bucket, and rejects other recipients", async () => {
    await expect(
      verifiedRevenue({
        settlement,
        payments: [{ depositAddress: "dep-1" }],
        status: async () => status({ amountOut: "9000000" }),
        raw: [{ bucket: "7", inflow: "5000000" }],
        currentBucket: 10n,
        bucketSec: 300n,
        receipts: [],
      }),
    ).rejects.toThrow("exceeds on-chain inflow");
    expect(checkDelivery(status({}), "dep-1", "someone.else.near")).toMatch(/^recipient/);
  });
});

// ---------- NEAR AI (E11–E15) ----------

const MODEL = "z-ai/glm-5.3-flash";
const modelSk = Uint8Array.from({ length: 32 }, (_, i) => i + 11);
const gatewaySk = Uint8Array.from({ length: 32 }, (_, i) => i + 99);
const addressOf = (sk: Uint8Array) =>
  `0x${toHex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20))}`;

function signEip191(text: string, sk: Uint8Array): string {
  const msg = utf8(text);
  const hash = keccak_256(concatBytes(utf8(`\x19Ethereum Signed Message:\n${msg.length}`), msg));
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(hash, sk, { prehash: false, format: "recovered" }),
    "recovered",
  );
  const be = (n: bigint) => fromHex(n.toString(16).padStart(64, "0"));
  return `0x${toHex(concatBytes(be(sig.r), be(sig.s), Uint8Array.of(27 + sig.recovery!)))}`;
}

const EVENTS = JSON.stringify([
  { imr: 0, event_type: 1, digest: "", event: "boot", event_payload: "00" },
  { imr: 3, event_type: 134217729, digest: "", event: "compose-hash", event_payload: "abcd" },
  { imr: 3, event_type: 134217729, digest: "", event: "app-id", event_payload: "0102" },
]);
const COMPOSE = '{"services":{"model":{"image":"nearai/model@sha256:00"}}}';

/** The fake "quote" is JSON the fake verifier reads back, built so every real check can pass. */
function attestation(sk: Uint8Array, nonce: string, over: { reportNonce?: string; echo?: string } = {}) {
  const addr = fromHex(addressOf(sk));
  const reportData = concatBytes(addr, new Uint8Array(12), fromHex(over.reportNonce ?? nonce));
  const quote = {
    reportData: toHex(reportData),
    rtmr3: toHex(replayRtmr3(EVENTS)),
    mrConfigId: toHex(expectedMrConfigId(COMPOSE)),
  };
  return {
    intel_quote: toHex(utf8(JSON.stringify(quote))),
    event_log: EVENTS,
    request_nonce: over.echo ?? nonce,
    signing_address: addressOf(sk),
    signing_algo: "ecdsa",
    info: { tcb_info: JSON.stringify({ app_compose: COMPOSE }) },
  };
}

const fakeQuotes: QuoteVerifier = {
  async verify(q) {
    const v = JSON.parse(fromUtf8(q)) as { reportData: string; rtmr3: string; mrConfigId: string };
    return {
      status: "UpToDate",
      reportData: fromHex(v.reportData),
      rtmr3: fromHex(v.rtmr3),
      mrConfigId: fromHex(v.mrConfigId),
      tdAttributes: new Uint8Array(8),
    };
  },
};
const verifyDeps = { quotes: fakeQuotes, nvidia: { attest: async () => [["JWT", "x"]] } };

interface NearAiFake {
  gatewayOnly?: boolean;
  replies?: string[];
  signatureKind?: string;
  signModel?: string;
  tamperResponse?: boolean;
}

function nearAiFetch(o: NearAiFake = {}) {
  let req: Uint8Array = new Uint8Array();
  let res: Uint8Array = new Uint8Array();
  let n = 0;
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === "/v1/attestation/report") {
      const nonce = u.searchParams.get("nonce")!;
      return json({
        gateway_attestation: attestation(gatewaySk, nonce),
        model_attestations: o.gatewayOnly ? [] : [attestation(modelSk, nonce)],
      });
    }
    if (u.pathname === "/v1/chat/completions") {
      req = init!.body as Uint8Array;
      const content = o.replies?.[n] ?? '[{"month":"2026-08","currency":"USD","incoming_total":"4100.00"}]';
      n += 1;
      res = utf8(JSON.stringify({ id: `chat-${n}`, choices: [{ message: { content } }] }));
      return new Response(o.tamperResponse ? utf8(fromUtf8(res).replace("4100", "9100")) : res);
    }
    if (u.pathname.startsWith("/v1/signature/")) {
      const kind = o.signatureKind ?? "provider_tee";
      const text =
        kind === "gateway"
          ? `${toHex(sha256(req))}:${toHex(sha256(res))}`
          : `${o.signModel ?? MODEL}:${toHex(sha256(req))}:${toHex(sha256(res))}`;
      const sk = kind === "gateway" ? gatewaySk : modelSk;
      return json({
        text,
        signature: signEip191(text, sk),
        signing_address: addressOf(sk),
        signing_algo: "ecdsa",
        signature_kind: kind,
      });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const client = (o: NearAiFake = {}, dailyCalls = 20) =>
  new NearAi({
    base: "https://cloud-api.near.ai",
    apiKey: "sk-test-key-123",
    model: MODEL,
    verify: verifyDeps,
    dailyCalls,
    fetch: nearAiFetch(o),
  });

describe("NEAR AI verification", () => {
  it("recovers EIP-191 signers", () => {
    expect(recoverEip191("hello", signEip191("hello", modelSk))).toBe(addressOf(modelSk));
  });

  it("extracts statement totals with a verified receipt", async () => {
    const st = await client().extract("statement text");
    expect(st.medianMonthly).toBe(4_100_000_000n);
    expect(st.receiptHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{40,}$/);
  });

  it("E11: a wrong nonce is rejected", async () => {
    const nonce = "11".repeat(32);
    await expect(
      verifyAttestation(attestation(modelSk, nonce, { reportNonce: "22".repeat(32) }), nonce, verifyDeps),
    ).rejects.toThrow("report_data");
    await expect(
      verifyAttestation(attestation(modelSk, nonce, { echo: "33".repeat(32) }), nonce, verifyDeps),
    ).rejects.toThrow("request_nonce");
  });

  it("E12: a model ID mismatch is rejected", async () => {
    await expect(client({ signModel: "deepseek-ai/DeepSeek-V3.1" }).extract("s")).rejects.toThrow(
      "signed text",
    );
  });

  it("E13: gateway-only evidence is not accepted for model inference", async () => {
    await expect(client({ gatewayOnly: true }).extract("s")).rejects.toThrow("gateway-only");
    await expect(client({ signatureKind: "gateway" }).extract("s")).rejects.toThrow("not provider_tee");
  });

  it("E14: tampered response bytes fail the signature check", async () => {
    await expect(client({ tamperResponse: true }).extract("s")).rejects.toBeInstanceOf(EvidenceRejected);
    expect(() =>
      checkChatSignature(
        {
          text: "x",
          signature: signEip191("x", modelSk),
          signing_address: addressOf(modelSk),
          signing_algo: "ecdsa",
          signature_kind: "provider_tee",
        },
        MODEL,
        utf8("a"),
        utf8("b"),
        [],
      ),
    ).toThrow("signed text");
  });

  it("E15: invalid JSON twice drops the source; the daily cap is enforced", async () => {
    await expect(client({ replies: ["not json", "[]"] }).extract("s")).rejects.toThrow("invalid JSON twice");
    const capped = client({}, 1);
    await capped.extract("s");
    await expect(capped.extract("s")).rejects.toThrow("daily call cap");
  });
});
