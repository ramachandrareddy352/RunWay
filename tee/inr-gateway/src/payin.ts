// Pay-ins (design §9A.7, BUILD_PLAN T4b.6): collect → webhook → verify → re-fetch → record_payin.
import { sha256 } from "@noble/hashes/sha2.js";
import { errorCode, hmacB58, TGAS, type AgentSigner, type Logger, type Reader } from "@runway/agent-kit";
import { inrToUsdc, type Oracle } from "@runway/fx";
import {
  base58Encode,
  randomBytes,
  toHex,
  utf8,
  type FloatView,
  type GatewayLimits,
  type PayinReceipt,
} from "@runway/sdk";
import type { InrProvider } from "./providers/types.js";
import type { CollectKind, CollectRow, GatewayStore } from "./store.js";

export interface GatewayIds {
  inr: string;
  credit: string;
  factory: string;
}

export interface PayinDeps {
  provider: InrProvider;
  store: GatewayStore;
  oracle: Oracle;
  reader: Reader;
  signer: AgentSigner;
  ids: GatewayIds;
  /** K_app-derived key for payer reference HMACs. */
  payerKey: Uint8Array;
  log: Logger;
  now?: () => number;
  /** Collect lifetime (Razorpay allows 2 min – 2 h). */
  ttlSec?: number;
  /** Called after a pay-in is Delivered (services wire it to the API so the keeper settles UPI sales). */
  onDelivered?: (c: CollectRow) => Promise<void>;
}

export class CollectRefused extends Error {}

export interface CollectRequest {
  kind: "merchant_sale" | "lender_deposit" | "repayment";
  handle?: string;
  beneficiary?: string;
  loan_id?: string;
  amount_paise: string;
}

export interface CollectResponse {
  collect_id: string;
  provider: string;
  qr_image_url?: string;
  mock_url?: string;
  rate_ppu_estimate: number;
  usdc_estimate: string;
  expires_at: string;
  simulated: boolean;
}

const HANDLE = /^[a-z0-9]{2,32}$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function kindOf(r: CollectRequest): CollectKind {
  if (r.kind === "merchant_sale") {
    if (!r.handle || !HANDLE.test(r.handle)) throw new CollectRefused("bad handle");
    return { type: "merchant_sale", handle: r.handle };
  }
  if (r.kind === "lender_deposit") {
    if (!r.beneficiary || r.beneficiary.length > 64 || !ACCOUNT.test(r.beneficiary))
      throw new CollectRefused("bad beneficiary");
    return { type: "lender_deposit", beneficiary: r.beneficiary };
  }
  if (!r.loan_id || !/^\d{1,19}$/.test(r.loan_id)) throw new CollectRefused("bad loan id");
  return { type: "repayment", loan_id: r.loan_id };
}

/** POST /inr/collect pre-checks (E23), then the provider collect. */
export async function createCollect(r: CollectRequest, d: PayinDeps): Promise<CollectResponse> {
  const now = (d.now ?? Date.now)();
  if (!/^[1-9]\d{0,15}$/.test(r.amount_paise)) throw new CollectRefused("bad amount");
  const amount = BigInt(r.amount_paise);
  const kind = kindOf(r);

  const rate = await d.oracle.read();
  if (rate.paused) throw new CollectRefused(`FX oracle paused: ${rate.reason ?? "sources disagree"}`);

  const snap = await d.reader.snapshot();
  const [config, limits, float] = await Promise.all([
    snap.view<{ paused_payins: boolean }>(d.ids.inr, "get_config"),
    snap.view<GatewayLimits>(d.ids.inr, "get_limits"),
    snap.view<FloatView>(d.ids.inr, "get_float"),
  ]);
  if (config.paused_payins) throw new CollectRefused("pay-ins are paused");
  if (rate.ratePpu < limits.min_rate_ppu || rate.ratePpu > limits.max_rate_ppu)
    throw new CollectRefused("FX rate outside the contract's band");
  if (amount > BigInt(limits.max_payin_paise)) throw new CollectRefused("amount above the per-payment cap");

  if (kind.type === "merchant_sale") {
    const m = await snap.view<unknown>(d.ids.credit, "get_merchant", { handle: kind.handle });
    if (!m) throw new CollectRefused("unknown merchant");
  } else if (kind.type === "lender_deposit") {
    const s = await snap.view<unknown>(d.ids.credit, "storage_balance_of", { account_id: kind.beneficiary });
    if (!s) throw new CollectRefused("beneficiary has no share storage on the vault (storage_deposit first)");
  } else {
    const l = await snap.view<{ status: string } | null>(d.ids.credit, "get_loan", { loan_id: kind.loan_id });
    if (!l || (l.status !== "Active" && l.status !== "Delinquent"))
      throw new CollectRefused("loan is not active");
  }

  const usdc = inrToUsdc(amount, rate.ratePpu, limits.spread_bps);
  if (usdc === 0n) throw new CollectRefused("amount too small");
  if (usdc > BigInt(float.free)) throw new CollectRefused("not enough gateway float for this amount");

  const collectId = `col_${toHex(randomBytes(12))}`;
  const ttlSec = d.ttlSec ?? 15 * 60;
  const label =
    kind.type === "merchant_sale"
      ? kind.handle
      : kind.type === "lender_deposit"
        ? "deposit"
        : `loan ${kind.loan_id}`;
  const c = await d.provider.createCollect({
    collectId,
    amountPaise: amount,
    label,
    notes: { collect_id: collectId, kind: kind.type },
    ttlSec,
  });
  d.store.addCollect({
    collectId,
    kind,
    amountPaise: amount,
    provider: d.provider.name,
    providerRef: c.providerRef,
    createdAt: now,
    expiresAt: c.expiresAt.getTime(),
    rateEstimate: rate.ratePpu,
    usdcEstimate: usdc,
    simulated: c.simulated,
  });
  d.log.info("collect_created", { collect_id: collectId, kind: kind.type, provider: d.provider.name });
  return {
    collect_id: collectId,
    provider: d.provider.name,
    qr_image_url: c.qrImageUrl,
    mock_url: c.mockUrl,
    rate_ppu_estimate: rate.ratePpu,
    usdc_estimate: usdc.toString(),
    expires_at: c.expiresAt.toISOString(),
    simulated: c.simulated,
  };
}

/** POST /inr/webhook/:provider. False → the signature didn't verify (nothing is recorded, E16). */
export async function handleWebhook(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  d: PayinDeps,
): Promise<boolean> {
  const ev = d.provider.verifyWebhook(rawBody, headers);
  if (!ev) {
    d.log.warn("webhook_rejected", { provider: d.provider.name });
    return false;
  }
  if (!d.store.firstSeen(ev.eventId, (d.now ?? Date.now)())) return true; // E18: duplicate delivery
  if (ev.paymentId) await confirmPayment(ev.paymentId, d);
  return true;
}

export const paymentRefHash = (provider: string, paymentId: string) =>
  base58Encode(sha256(utf8(`${provider}:${paymentId}`)));

/** Re-fetches the payment from the provider and records it on-chain only if every check passes (E17). */
export async function confirmPayment(paymentId: string, d: PayinDeps): Promise<void> {
  const now = (d.now ?? Date.now)();
  const p = await d.provider.fetchPayment(paymentId);
  const c = p.notes.collect_id ? d.store.get(p.notes.collect_id) : undefined;
  const fail = (reason: string) => {
    d.log.warn("payment_rejected", { collect_id: c?.collectId, reason });
    if (c && c.status === "pending" && reason === "payment failed")
      d.store.setStatus(c.collectId, "failed", reason);
  };
  if (!c) return fail("unknown collect");
  if (c.provider !== d.provider.name) return fail("collect belongs to another provider");
  if (p.status === "failed") return fail("payment failed");
  if (p.status !== "captured") return fail(`status ${p.status}`);
  if (p.currency !== "INR") return fail("currency");
  if (p.method !== "upi") return fail("method");
  if (p.amountPaise !== c.amountPaise) return fail("amount");
  if (now > c.expiresAt + 5 * 60_000) return fail("collect expired");
  const hash = paymentRefHash(d.provider.name, p.id);
  const payer = p.vpa ? hmacB58(d.payerKey, `vpa:${p.vpa.toLowerCase()}`) : null;
  if (!d.store.claimPayment(c.collectId, p.id, hash, payer)) return; // already handled
  await recordPaid({ ...c, status: "paid", paymentId: p.id, paymentRefHash: hash, payerRefHash: payer }, d);
}

/** record_payin with the oracle rate at confirmation time. Retries reuse the same hash (replay-safe). */
export async function recordPaid(c: CollectRow, d: PayinDeps): Promise<void> {
  const rate = await d.oracle.read();
  if (rate.paused) {
    d.store.setStatus(c.collectId, "paid", "waiting for the FX oracle");
    return;
  }
  const args = {
    payment_ref_hash: c.paymentRefHash,
    kind: c.kind,
    inr_paise: c.amountPaise.toString(),
    rate_ppu: rate.ratePpu,
    payer_ref_hash: c.payerRefHash,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await d.signer.call("record_payin", args, { gas: 150n * TGAS });
      break;
    } catch (e) {
      const code = errorCode(e);
      if (code === "ERR_PAYIN_REPLAY") break; // an earlier attempt landed
      if (code.startsWith("ERR_")) {
        d.store.setStatus(c.collectId, "paid", `record_payin refused: ${code}`);
        d.log.warn("record_payin_refused", { collect_id: c.collectId, code });
        return;
      }
      if (attempt === 2) {
        d.store.setStatus(c.collectId, "paid", "chain unavailable; will retry");
        return;
      }
    }
  }
  const snap = await d.reader.snapshot();
  const receipt = await snap.view<PayinReceipt | null>(d.ids.inr, "get_receipt", {
    payment_ref_hash: c.paymentRefHash,
  });
  if (receipt?.status === "Delivered") {
    d.store.setStatus(c.collectId, "delivered");
    await d
      .onDelivered?.(c)
      .catch((e: unknown) =>
        d.log.warn("on_delivered_failed", { collect_id: c.collectId, code: errorCode(e) }),
      );
  } else if (receipt?.status === "Failed")
    d.store.setStatus(c.collectId, "failed", "delivery failed; the USDC stayed in the float");
  d.log.info("payin_recorded", { collect_id: c.collectId, status: receipt?.status ?? "unknown" });
}

/** Worker: retry paid-but-unrecorded collects (oracle was paused, or the chain was down). */
export async function retryPaid(d: PayinDeps): Promise<void> {
  for (const c of d.store.paid()) {
    if (c.reason?.startsWith("record_payin refused")) continue;
    await recordPaid(c, d).catch((e) =>
      d.log.warn("retry_failed", { collect_id: c.collectId, code: errorCode(e) }),
    );
  }
}
