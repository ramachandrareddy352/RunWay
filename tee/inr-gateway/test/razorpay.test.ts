// E24: Razorpay adapter fixtures — exact QR body, X-Payout-Idempotency, Basic auth, webhook HMAC.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex, utf8 } from "@runway/sdk";
import { describe, expect, it } from "vitest";
import { RazorpayProvider } from "../src/providers/razorpay.js";

const rp = new RazorpayProvider({
  keyId: "rzp_test_ABCDEF123",
  keySecret: "secret123",
  webhookSecret: "whsec_0123456789",
  accountNumber: "2323230000000000",
  now: () => 1_800_000_000_000,
});

describe("E24: Razorpay adapter", () => {
  it("builds the exact single-use UPI QR body", () => {
    expect(
      rp.qrBody({
        collectId: "col_1",
        amountPaise: 850_000n,
        label: "priya",
        notes: { kind: "merchant_sale" },
        ttlSec: 900,
      }),
    ).toEqual({
      type: "upi_qr",
      name: "Runway priya",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: 850_000,
      description: "Runway priya",
      close_by: 1_800_000_900,
      notes: { kind: "merchant_sale", collect_id: "col_1" },
    });
  });

  it("sends Basic auth and the payout idempotency header", () => {
    const r = rp.payoutRequest({
      fundAccountId: "fa_1",
      amountPaise: 698_360n,
      idempotencyKey: "payout-7",
      reference: "payout-7",
      mode: "UPI",
    });
    expect(r.url).toBe("https://api.razorpay.com/v1/payouts");
    expect(r.init.headers.authorization).toBe(
      `Basic ${Buffer.from("rzp_test_ABCDEF123:secret123").toString("base64")}`,
    );
    expect(r.init.headers["X-Payout-Idempotency"]).toBe("payout-7");
    expect(JSON.parse(r.init.body!)).toEqual({
      account_number: "2323230000000000",
      fund_account_id: "fa_1",
      amount: 698_360,
      currency: "INR",
      mode: "UPI",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: "payout-7",
      narration: "Runway payout",
    });
  });

  it("verifies webhooks over the raw body with the event id", () => {
    const raw = utf8(
      JSON.stringify({ event: "qr_code.credited", payload: { payment: { entity: { id: "pay_1" } } } }),
    );
    const sig = toHex(hmac(sha256, utf8("whsec_0123456789"), raw));
    expect(rp.verifyWebhook(raw, { "x-razorpay-signature": sig, "x-razorpay-event-id": "evt_1" })).toEqual({
      eventId: "evt_1",
      type: "qr_code.credited",
      paymentId: "pay_1",
      payoutId: undefined,
    });
    expect(rp.verifyWebhook(raw, { "x-razorpay-signature": sig })).toBeNull();
    // One extra byte (re-serialised body) breaks the HMAC.
    expect(
      rp.verifyWebhook(new Uint8Array([...raw, 32]), {
        "x-razorpay-signature": sig,
        "x-razorpay-event-id": "e",
      }),
    ).toBeNull();
  });
});
