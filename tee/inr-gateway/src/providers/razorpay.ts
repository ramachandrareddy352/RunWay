// RazorpayProvider (BUILD_PLAN T4b.5; Razorpay docs, Appendix). Basic auth `key_id:key_secret`.
//   UPI QR:   POST /v1/payments/qr_codes {type:"upi_qr", usage:"single_use", fixed_amount:true, ...}
//   Webhook:  X-Razorpay-Signature = hex HMAC-SHA256(raw body, webhook secret); dedupe x-razorpay-event-id
//   Payment:  GET /v1/payments/:id
//   Payouts:  POST /v1/contacts → POST /v1/fund_accounts → POST /v1/payouts (X-Payout-Idempotency)
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { equalBytes, fromHex, fromUtf8, toBase64, utf8 } from "@runway/sdk";
import { z } from "zod";
import {
  maskBeneficiary,
  type BeneficiaryDetails,
  type Collect,
  type InrProvider,
  type PayoutStatus,
  type ProviderPayment,
  type WebhookEvent,
} from "./types.js";

export interface RazorpayOptions {
  base?: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** RazorpayX source account for payouts (pending: RazorpayX signup, Amendment A1). */
  accountNumber?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const QrCode = z.object({
  id: z.string(),
  image_url: z.string().url(),
  close_by: z.number().int().optional(),
});
const Payment = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
  method: z.string(),
  vpa: z.string().nullable().optional(),
  created_at: z.number().int(),
  notes: z.union([z.record(z.string(), z.string()), z.array(z.unknown())]).optional(),
});
const PayoutStatusSchema = z.enum([
  "queued",
  "pending",
  "rejected",
  "processing",
  "processed",
  "cancelled",
  "reversed",
  "failed",
]);
const Payout = z.object({
  id: z.string(),
  status: PayoutStatusSchema,
  utr: z.string().nullable().optional(),
  status_details: z.object({ description: z.string().nullable().optional() }).nullable().optional(),
  failure_reason: z.string().nullable().optional(),
});

export class RazorpayProvider implements InrProvider {
  readonly name = "razorpay" as const;
  private readonly base: string;

  constructor(private readonly o: RazorpayOptions) {
    this.base = o.base ?? "https://api.razorpay.com";
  }

  private auth(): string {
    return `Basic ${toBase64(utf8(`${this.o.keyId}:${this.o.keySecret}`))}`;
  }

  /** Exposed for the fixture test (E24). */
  request(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } {
    return {
      url: `${this.base}${path}`,
      init: {
        method: init.method ?? "GET",
        headers: {
          authorization: this.auth(),
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      },
    };
  }

  private async call<T>(
    schema: z.ZodType<T>,
    path: string,
    init?: Parameters<RazorpayProvider["request"]>[1],
  ): Promise<T> {
    const r = this.request(path, init);
    const res = await (this.o.fetch ?? fetch)(r.url, r.init);
    if (!res.ok) throw new Error(`razorpay ${path.split("?")[0]}: HTTP ${res.status}`);
    return schema.parse(await res.json());
  }

  qrBody(i: {
    collectId: string;
    amountPaise: bigint;
    label: string;
    notes: Record<string, string>;
    ttlSec: number;
  }) {
    return {
      type: "upi_qr",
      name: `Runway ${i.label}`.slice(0, 64),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: Number(i.amountPaise),
      description: `Runway ${i.label}`.slice(0, 255),
      close_by: Math.floor((this.o.now ?? Date.now)() / 1000) + i.ttlSec,
      notes: { ...i.notes, collect_id: i.collectId },
    };
  }

  async createCollect(i: {
    collectId: string;
    amountPaise: bigint;
    label: string;
    notes: Record<string, string>;
    ttlSec: number;
  }): Promise<Collect> {
    const body = this.qrBody(i);
    const qr = await this.call(QrCode, "/v1/payments/qr_codes", { method: "POST", body });
    return {
      collectId: i.collectId,
      providerRef: qr.id,
      qrImageUrl: qr.image_url,
      expiresAt: new Date((qr.close_by ?? body.close_by) * 1000),
      simulated: false,
    };
  }

  verifyWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookEvent | null {
    const sig = headers["x-razorpay-signature"];
    const eventId = headers["x-razorpay-event-id"];
    if (!sig || !eventId || !/^[0-9a-f]{64}$/.test(sig)) return null;
    if (!equalBytes(fromHex(sig), hmac(sha256, utf8(this.o.webhookSecret), rawBody))) return null;
    try {
      const b = JSON.parse(fromUtf8(rawBody)) as {
        event?: string;
        payload?: { payment?: { entity?: { id?: string } }; payout?: { entity?: { id?: string } } };
      };
      if (!b.event) return null;
      return {
        eventId,
        type: b.event,
        paymentId: b.payload?.payment?.entity?.id,
        payoutId: b.payload?.payout?.entity?.id,
      };
    } catch {
      return null;
    }
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const p = await this.call(Payment, `/v1/payments/${encodeURIComponent(paymentId)}`);
    return {
      id: p.id,
      amountPaise: BigInt(p.amount),
      currency: p.currency,
      status: p.status,
      method: p.method,
      vpa: p.vpa ?? undefined,
      createdAt: new Date(p.created_at * 1000),
      notes: Array.isArray(p.notes) || !p.notes ? {} : p.notes,
      simulated: false,
    };
  }

  async ensureBeneficiary(d: BeneficiaryDetails): Promise<{ fundAccountId: string; masked: string }> {
    const contact = await this.call(z.object({ id: z.string() }), "/v1/contacts", {
      method: "POST",
      body: { name: d.name, type: "customer" },
    });
    const body =
      d.type === "vpa"
        ? { contact_id: contact.id, account_type: "vpa", vpa: { address: d.vpa } }
        : {
            contact_id: contact.id,
            account_type: "bank_account",
            bank_account: { name: d.name, ifsc: d.ifsc, account_number: d.accountNumber },
          };
    const fa = await this.call(z.object({ id: z.string() }), "/v1/fund_accounts", { method: "POST", body });
    return { fundAccountId: fa.id, masked: maskBeneficiary(d) };
  }

  payoutRequest(i: {
    fundAccountId: string;
    amountPaise: bigint;
    idempotencyKey: string;
    reference: string;
    mode: "UPI" | "IMPS";
  }) {
    if (!this.o.accountNumber) throw new Error("RAZORPAYX_ACCOUNT_NUMBER is not set");
    return this.request("/v1/payouts", {
      method: "POST",
      headers: { "X-Payout-Idempotency": i.idempotencyKey },
      body: {
        account_number: this.o.accountNumber,
        fund_account_id: i.fundAccountId,
        amount: Number(i.amountPaise),
        currency: "INR",
        mode: i.mode,
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: i.reference,
        narration: "Runway payout",
      },
    });
  }

  async createPayout(i: {
    fundAccountId: string;
    amountPaise: bigint;
    idempotencyKey: string;
    reference: string;
    mode: "UPI" | "IMPS";
  }): Promise<{ payoutId: string; status: PayoutStatus }> {
    const r = this.payoutRequest(i);
    const res = await (this.o.fetch ?? fetch)(r.url, r.init);
    if (!res.ok) throw new Error(`razorpay /v1/payouts: HTTP ${res.status}`);
    const p = Payout.parse(await res.json());
    return { payoutId: p.id, status: p.status };
  }

  async fetchPayout(
    payoutId: string,
  ): Promise<{ status: PayoutStatus; utr?: string; failureReason?: string }> {
    const p = await this.call(Payout, `/v1/payouts/${encodeURIComponent(payoutId)}`);
    return {
      status: p.status,
      utr: p.utr ?? undefined,
      failureReason: p.failure_reason ?? p.status_details?.description ?? undefined,
    };
  }
}
