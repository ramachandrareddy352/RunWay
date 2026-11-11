// MockInrProvider (BUILD_PLAN T4b.5): SIMULATED UPI for sandbox and testnet builds only. Never
// bundled into a mainnet image (test E22). Its webhooks are HMAC-signed over the raw body with
// MOCK_WEBHOOK_SECRET, so they go through the same verification path as real ones.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { equalBytes, fromHex, fromUtf8, toHex, utf8 } from "@runway/sdk";
import {
  maskBeneficiary,
  type BeneficiaryDetails,
  type Collect,
  type InrProvider,
  type PayoutStatus,
  type ProviderPayment,
  type WebhookEvent,
} from "./types.js";

interface MockCollect {
  amountPaise: bigint;
  notes: Record<string, string>;
  expiresAt: Date;
  paid: boolean;
}

export class MockInrProvider implements InrProvider {
  readonly name = "mock" as const;
  private n = 0;
  private readonly collects = new Map<string, MockCollect>();
  private readonly payments = new Map<string, ProviderPayment>();
  private readonly payouts = new Map<string, { status: PayoutStatus; utr?: string }>();
  private readonly byIdempotency = new Map<string, string>();
  /** How many distinct payouts were created (tests check exactly-once). */
  get payoutCount(): number {
    return this.payouts.size;
  }

  constructor(private readonly o: { publicUrl: string; webhookSecret: string; now?: () => number }) {
    if (o.webhookSecret.length < 16) throw new Error("MOCK_WEBHOOK_SECRET must be at least 16 characters");
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  async createCollect(i: {
    collectId: string;
    amountPaise: bigint;
    notes: Record<string, string>;
    ttlSec: number;
  }): Promise<Collect> {
    const expiresAt = new Date(this.now() + i.ttlSec * 1000);
    this.collects.set(i.collectId, { amountPaise: i.amountPaise, notes: i.notes, expiresAt, paid: false });
    return {
      collectId: i.collectId,
      providerRef: `mock_qr_${++this.n}`,
      mockUrl: `${this.o.publicUrl}/mock/upi/${encodeURIComponent(i.collectId)}`,
      expiresAt,
      simulated: true,
    };
  }

  collect(collectId: string): (MockCollect & { collectId: string }) | undefined {
    const c = this.collects.get(collectId);
    return c ? { ...c, collectId } : undefined;
  }

  /** The SIMULATED UPI page's buttons: makes the payment and returns the signed webhook to deliver. */
  simulate(
    collectId: string,
    outcome: "success" | "failure",
    vpa = "customer@okmock",
  ): { rawBody: Uint8Array; headers: Record<string, string> } {
    const c = this.collects.get(collectId);
    if (!c) throw new Error("unknown collect");
    if (c.paid) throw new Error("already paid");
    if (this.now() > c.expiresAt.getTime()) throw new Error("collect expired");
    c.paid = outcome === "success";
    const id = `mock_pay_${++this.n}`;
    this.payments.set(id, {
      id,
      amountPaise: c.amountPaise,
      currency: "INR",
      status: outcome === "success" ? "captured" : "failed",
      method: "upi",
      vpa,
      createdAt: new Date(this.now()),
      notes: c.notes,
      simulated: true,
    });
    return this.signedEvent({ event: "qr_code.credited", event_id: `mock_evt_${++this.n}`, payment_id: id });
  }

  /** Builds a webhook exactly as the mock "provider" would send it. */
  signedEvent(body: Record<string, unknown>): { rawBody: Uint8Array; headers: Record<string, string> } {
    const rawBody = utf8(JSON.stringify(body));
    return {
      rawBody,
      headers: { "x-mock-signature": toHex(hmac(sha256, utf8(this.o.webhookSecret), rawBody)) },
    };
  }

  verifyWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookEvent | null {
    const sig = headers["x-mock-signature"];
    if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
    if (!equalBytes(fromHex(sig), hmac(sha256, utf8(this.o.webhookSecret), rawBody))) return null;
    try {
      const b = JSON.parse(fromUtf8(rawBody)) as { event?: string; event_id?: string; payment_id?: string };
      if (!b.event || !b.event_id) return null;
      return { eventId: b.event_id, type: b.event, paymentId: b.payment_id };
    } catch {
      return null;
    }
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error("payment not found");
    return p;
  }

  async ensureBeneficiary(d: BeneficiaryDetails): Promise<{ fundAccountId: string; masked: string }> {
    const key = d.type === "vpa" ? d.vpa : `${d.ifsc}:${d.accountNumber}`;
    return { fundAccountId: `mock_fa_${toHex(sha256(utf8(key))).slice(0, 14)}`, masked: maskBeneficiary(d) };
  }

  async createPayout(i: {
    fundAccountId: string;
    amountPaise: bigint;
    idempotencyKey: string;
  }): Promise<{ payoutId: string; status: PayoutStatus }> {
    const existing = this.byIdempotency.get(i.idempotencyKey);
    if (existing) return { payoutId: existing, status: this.payouts.get(existing)!.status };
    const id = `mock_pout_${++this.n}`;
    this.byIdempotency.set(i.idempotencyKey, id);
    this.payouts.set(id, { status: "processed", utr: `MOCKUTR${id.replace(/\D/g, "")}` });
    return { payoutId: id, status: "processed" };
  }

  async fetchPayout(payoutId: string): Promise<{ status: PayoutStatus; utr?: string }> {
    const p = this.payouts.get(payoutId);
    if (!p) throw new Error("payout not found");
    return p;
  }
}
