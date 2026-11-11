// `InrProvider` (BUILD_PLAN §9.10). Amounts are integer paise.
export type PayoutStatus =
  "queued" | "pending" | "rejected" | "processing" | "processed" | "cancelled" | "reversed" | "failed";

export const TERMINAL_PAYOUT: readonly PayoutStatus[] = [
  "processed",
  "rejected",
  "cancelled",
  "reversed",
  "failed",
];

export interface Collect {
  collectId: string;
  providerRef: string;
  qrImageUrl?: string;
  mockUrl?: string;
  expiresAt: Date;
  simulated: boolean;
}

export interface ProviderPayment {
  id: string;
  amountPaise: bigint;
  currency: "INR" | string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method: string;
  vpa?: string;
  createdAt: Date;
  notes: Record<string, string>;
  simulated: boolean;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  paymentId?: string;
  payoutId?: string;
}

export type BeneficiaryDetails =
  | { type: "vpa"; name: string; vpa: string }
  | { type: "bank_account"; name: string; ifsc: string; accountNumber: string };

export interface InrProvider {
  readonly name: "razorpay" | "mock";
  createCollect(i: {
    collectId: string;
    amountPaise: bigint;
    label: string;
    notes: Record<string, string>;
    ttlSec: number;
  }): Promise<Collect>;
  /** Signature over the RAW body; null → reject. */
  verifyWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookEvent | null;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  ensureBeneficiary(d: BeneficiaryDetails): Promise<{ fundAccountId: string; masked: string }>;
  createPayout(i: {
    fundAccountId: string;
    amountPaise: bigint;
    idempotencyKey: string;
    reference: string;
    mode: "UPI" | "IMPS";
  }): Promise<{ payoutId: string; status: PayoutStatus }>;
  fetchPayout(payoutId: string): Promise<{ status: PayoutStatus; utr?: string; failureReason?: string }>;
}

/** "priya@okaxis" → "pr***@okaxis"; "123456789012" → "XXXXXXXX9012". */
export function maskBeneficiary(d: BeneficiaryDetails): string {
  if (d.type === "vpa") {
    const [user = "", host = ""] = d.vpa.split("@");
    return `${user.slice(0, 2)}***@${host}`;
  }
  return `${d.ifsc.slice(0, 4)} ${"X".repeat(Math.max(0, d.accountNumber.length - 4))}${d.accountNumber.slice(-4)}`;
}
