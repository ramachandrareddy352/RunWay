// Wallet transactions and agent flows used by the pages. Every amount is micro-USDC (bigint).
import {
  beneficiaryMessage,
  BENEFICIARY_CONTEXT,
  ftMsg,
  GATEWAY_RECIPIENT,
  underwriteMessage,
  UNDERWRITE_CONTEXT,
  UNDERWRITE_RECIPIENT,
  UNDERWRITE_RESPONSE_CONTEXT,
  verifyCommitment,
  type PayoutRequest,
  type Sealed,
} from "@runway/sdk";
import type { BeneficiaryInput } from "../components/PayoutSettings";
import type { CollectBody, CollectReply, CollectState } from "../components/PayUpi";
import { postSealed, verifiedSession } from "./agents";
import { credit, gateway, view } from "./chain";
import { API_URL, DEPLOYMENT, GATEWAY_URL, UNDERWRITER_URL } from "./env";
import { TGAS, type RunwayWallet } from "./wallet";

const YOCTO = 1n;
const STORAGE_DEPOSIT = 10n ** 22n; // 0.01 NEAR

export const ftTransferCall = (w: RunwayWallet, receiver: string, amount: bigint, msg: string) =>
  w.call(
    DEPLOYMENT.token,
    "ft_transfer_call",
    { receiver_id: receiver, amount: amount.toString(), msg },
    { deposit: YOCTO, gas: 150n * TGAS },
  );

export const storageDeposit = (w: RunwayWallet, contract: string, accountId: string) =>
  w.call(
    contract,
    "storage_deposit",
    { account_id: accountId, registration_only: true },
    { deposit: STORAGE_DEPOSIT, gas: 30n * TGAS },
  );

export async function registerMerchant(w: RunwayWallet, handle: string) {
  const deposit = BigInt((await view(DEPLOYMENT.factory, "required_deposit", {})) as string);
  return w.call(DEPLOYMENT.credit, "register_merchant", { handle }, { deposit, gas: 300n * TGAS });
}

export const claimPayout = (w: RunwayWallet) =>
  w.call(DEPLOYMENT.credit, "claim_payout", {}, { gas: 100n * TGAS });
export const updatePayout = (w: RunwayWallet, newPayout: string) =>
  w.call(DEPLOYMENT.credit, "update_payout", { new_payout: newPayout }, { deposit: YOCTO, gas: 150n * TGAS });
export const setPayoutMode = (w: RunwayWallet, mode: "Usdc" | "Inr") =>
  w.call(DEPLOYMENT.credit, "set_payout_mode", { mode }, { deposit: YOCTO, gas: 30n * TGAS });
export const acceptOffer = (w: RunwayWallet, offerId: string, amount: bigint) =>
  w.call(
    DEPLOYMENT.credit,
    "accept_offer",
    { offer_id: offerId, amount: amount.toString() },
    { deposit: YOCTO, gas: 300n * TGAS },
  );
export const depositUsdc = (w: RunwayWallet, amount: bigint) =>
  ftTransferCall(w, DEPLOYMENT.credit, amount, ftMsg.deposit());
export const requestWithdraw = async (w: RunwayWallet, shares: bigint, payout: "Usdc" | "Inr") =>
  String(
    await w.call(
      DEPLOYMENT.credit,
      "request_withdraw",
      { shares: shares.toString(), payout },
      { deposit: YOCTO, gas: 50n * TGAS },
    ),
  );
export const claimWithdraw = (w: RunwayWallet, id: string) =>
  w.call(DEPLOYMENT.credit, "claim_withdraw", { request_id: id }, { gas: 150n * TGAS });
export const cancelWithdraw = (w: RunwayWallet, id: string) =>
  w.call(DEPLOYMENT.credit, "cancel_withdraw", { request_id: id }, { gas: 50n * TGAS });

// ---------- API ----------

export async function simulatePayment(handle: string, amount: bigint): Promise<{ depositAddress: string }> {
  const res = await fetch(`${API_URL}/dev/simulate-payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, amount: amount.toString() }),
  });
  const body = (await res.json()) as { depositAddress?: string; error?: string };
  if (!res.ok || !body.depositAddress)
    throw new Error(body.error ?? `simulated payment failed (HTTP ${res.status})`);
  return { depositAddress: body.depositAddress };
}

export async function logPayment(handle: string, depositAddress: string): Promise<void> {
  await fetch(`${API_URL}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, depositAddress }),
  });
}

// ---------- INR gateway ----------

export async function collect(body: CollectBody): Promise<CollectReply> {
  const res = await fetch(`${GATEWAY_URL}/inr/collect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const r = (await res.json()) as CollectReply & { error?: string };
  if (!res.ok) throw new Error(r.error ?? `collect failed (HTTP ${res.status})`);
  return r;
}

export async function collectStatus(id: string): Promise<CollectState> {
  const res = await fetch(`${GATEWAY_URL}/inr/collect/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CollectState;
}

export async function registerBeneficiary(w: RunwayWallet, b: BeneficiaryInput): Promise<{ masked: string }> {
  if (!w.accountId) throw new Error("connect a wallet first");
  const s = await verifiedSession(GATEWAY_URL, "InrGateway", gateway.agent);
  const auth = await w.signNep413(beneficiaryMessage(w.accountId), GATEWAY_RECIPIENT);
  const { reply } = await postSealed<{ ok: boolean; masked: string }>(
    `${GATEWAY_URL}/inr/beneficiary`,
    { ...b, nep413_auth: auth, account_id: w.accountId },
    s.sessionPub,
    BENEFICIARY_CONTEXT,
  );
  return { masked: reply.masked };
}

/** Payouts for an account, newest first. There is no per-beneficiary index, so this scans ids. */
export async function payoutsFor(accountId: string, max = 200): Promise<PayoutRequest[]> {
  const out: PayoutRequest[] = [];
  for (let id = 1; id <= max; id++) {
    const p = await gateway.payout(String(id));
    if (!p) break;
    if (p.beneficiary === accountId) out.push(p);
  }
  return out.reverse();
}

// ---------- underwriter ----------

export interface OfferResult {
  decision: "offer" | "decline";
  offer_id?: string;
  reasons: string[];
  terms?: { grade: string; limit: string; fee_bps: number; repay_bps: number; expires_at_sec: number };
  commitmentOk?: boolean;
  evidence?: unknown;
}

export async function requestOffer(
  w: RunwayWallet,
  handle: string,
  extras: {
    stripe_key?: string;
    statements?: { name: string; mime: "text/csv" | "application/pdf"; data_b64: string }[];
  },
): Promise<OfferResult> {
  const s = await verifiedSession(UNDERWRITER_URL, "Underwriter", credit.agent);
  const nep413 = await w.signNep413(underwriteMessage(handle), UNDERWRITE_RECIPIENT);
  const { reply, open } = await postSealed<OfferResult & { sealed: Sealed }>(
    `${UNDERWRITER_URL}/underwrite`,
    { handle, nep413, ...extras },
    s.sessionPub,
    UNDERWRITE_CONTEXT,
  );
  const sealed = open<{ inputs: unknown; salt: string; commitment: string | null; evidence: unknown }>(
    reply.sealed,
    UNDERWRITE_RESPONSE_CONTEXT,
  );
  let commitmentOk: boolean | undefined;
  if (reply.decision === "offer" && reply.offer_id) {
    const offer = await credit.offer(reply.offer_id);
    commitmentOk = !!offer && verifyCommitment(offer.inputs_commitment, sealed.inputs, sealed.salt);
    try {
      localStorage.setItem(
        `runway:sealed:${reply.offer_id}`,
        JSON.stringify({ inputs: sealed.inputs, salt: sealed.salt }),
      );
    } catch {
      /* storage unavailable */
    }
  }
  return { ...reply, commitmentOk, evidence: sealed.evidence };
}
