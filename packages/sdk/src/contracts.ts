// Typed views and call builders for the Runway contracts. Transport-agnostic: pass any `Viewer`
// (dual-RPC `viewAgreed`, near-workspaces in the sandbox, or a wallet provider in the web app).

import type { AgentView } from "./session.js";

export type Viewer = (contract: string, method: string, args: Record<string, unknown>) => Promise<unknown>;

/** Mirrors contracts/credit/src/types.rs JSON (U128/U64 are decimal strings). */
export interface MerchantView {
  merchant: {
    handle: string;
    payout: string;
    settlement: string;
    payout_mode: "Usdc" | "Inr";
    created_sec: number;
    frozen: boolean;
    active_loan: string | null;
    open_offer: string | null;
    anchor: string | null;
  };
  record: {
    loans_repaid: number;
    loans_defaulted: number;
    total_borrowed: string;
    total_repaid: string;
    member_since_sec: number;
  };
  claimable: string;
}

export interface LoanView {
  id: string;
  handle: string;
  principal: string;
  fee: string;
  owed: string;
  repaid: string;
  principal_repaid: string;
  repay_bps: number;
  status: "PendingTerms" | "PendingTransfer" | "Active" | "Delinquent" | "Repaid" | "Defaulted" | "Failed";
  provisioned: string;
}

export interface VaultView {
  cash: string;
  reserved: string;
  free_cash: string;
  outstanding_principal: string;
  provisions: string;
  reserve: string;
  total_assets: string;
  total_shares: string;
  share_price_1e6: string;
  utilization_bps: number;
  merchant_claimable_total: string;
  in_transit: string;
  active_loans: number;
}

export interface OfferView {
  id: string;
  handle: string;
  limit: string;
  fee_bps: number;
  repay_bps: number;
  grade: "A" | "B" | "C";
  anchor_hash: string | null;
  inputs_commitment: string;
  llm_receipt_hash: string | null;
  agent: string;
  measurements_hash: string;
  policy_version: number;
  created_sec: number;
  expires_at_sec: number;
  status: "Open" | "Accepted" | "Superseded";
}

export interface WithdrawRequestView {
  id: string;
  owner: string;
  shares: string;
  ready_at_sec: number;
  payout: "Usdc" | "Inr";
  status: "Open" | "Claiming";
}

export interface ApprovedView {
  requires_tee: boolean;
  attestation_expiration_time_ms: string;
  measurements: { measurements: unknown; measurements_hash: string; role: string | null }[];
  ppids: unknown[];
  whitelisted_agents_for_local: string[];
}

export interface SettlementState {
  credit: string;
  token: string;
  bucket_sec: string;
  terms: { loan_id: string; repay_bps: number } | null;
  pending_repay: string;
  pending_payout: string;
  op: string | null;
  unresolved: string | null;
  current_bucket: string;
}

export interface Bucket {
  bucket: string;
  inflow: string;
}

export function creditViews(view: Viewer, credit: string) {
  return {
    merchant: (handle: string) => view(credit, "get_merchant", { handle }) as Promise<MerchantView | null>,
    merchantByAccount: (account_id: string) =>
      view(credit, "get_merchant_by_account", { account_id }) as Promise<MerchantView | null>,
    loan: (loan_id: string) => view(credit, "get_loan", { loan_id }) as Promise<LoanView | null>,
    vault: () => view(credit, "get_vault", {}) as Promise<VaultView>,
    policy: () => view(credit, "get_policy", {}) as Promise<Record<string, unknown>>,
    agent: (account_id: string) => view(credit, "get_agent", { account_id }) as Promise<AgentView | null>,
    approved: () => view(credit, "get_approved", {}) as Promise<ApprovedView>,
    config: () => view(credit, "get_config", {}) as Promise<Record<string, unknown>>,
    offer: (offer_id: string) => view(credit, "get_offer", { offer_id }) as Promise<OfferView | null>,
    record: (handle: string) =>
      view(credit, "get_record", { handle }) as Promise<MerchantView["record"] | null>,
    activeLoans: () => view(credit, "get_active_loans", {}) as Promise<LoanView[]>,
    withdrawRequest: (request_id: string) =>
      view(credit, "get_withdraw_request", { request_id }) as Promise<WithdrawRequestView | null>,
    shares: (account_id: string) => view(credit, "ft_balance_of", { account_id }) as Promise<string>,
    exitAppCid: () => view(credit, "get_exit_app_cid", {}) as Promise<string | null>,
    lastOp: (settlement: string) => view(credit, "get_last_op", { settlement }) as Promise<string>,
  };
}

export function settlementViews(view: Viewer) {
  return {
    state: (settlement: string) => view(settlement, "get_state", {}) as Promise<SettlementState>,
    buckets: (settlement: string) => view(settlement, "get_buckets", {}) as Promise<Bucket[]>,
  };
}

/**
 * Complete buckets oldest → newest, filling gaps with zero, excluding the current (incomplete)
 * bucket. Feeds `@runway/scoring` in sandbox/testnet (`revenueSource: *-buckets`).
 */
export function completeBuckets(buckets: Bucket[], currentBucket: bigint): bigint[] {
  const map = new Map(buckets.map((b) => [BigInt(b.bucket), BigInt(b.inflow)]));
  const done = [...map.keys()].filter((k) => k < currentBucket);
  if (done.length === 0) return [];
  const first = done.reduce((a, b) => (b < a ? b : a));
  const out: bigint[] = [];
  for (let i = first; i < currentBucket; i++) out.push(map.get(i) ?? 0n);
  return out;
}

export type PayoutKind = "merchant_share" | "loan_disbursement" | "lender_withdrawal" | "self_offramp";

/** `ft_on_transfer` message strings (BUILD_PLAN §9.2). */
export const ftMsg = {
  deposit: () => JSON.stringify({ action: "deposit" }),
  depositFor: (beneficiary: string) => JSON.stringify({ action: "deposit_for", beneficiary }),
  seedReserve: () => JSON.stringify({ action: "seed_reserve" }),
  repay: (loanId: string) => JSON.stringify({ action: "repay", loan_id: loanId }),
  fundFloat: () => JSON.stringify({ action: "fund_float" }),
  inrPayout: (kind: PayoutKind, beneficiary: string, reference: string) =>
    JSON.stringify({ action: "inr_payout", kind, beneficiary, reference }),
};

// ---------- INR gateway (BUILD_PLAN §9.8) ----------

export type PayinKind =
  | { type: "merchant_sale"; handle: string }
  | { type: "lender_deposit"; beneficiary: string }
  | { type: "repayment"; loan_id: string };

export interface PayinReceipt {
  kind: PayinKind;
  inr_paise: string;
  rate_ppu: number;
  spread_bps: number;
  usdc: string;
  delivered: string;
  payer_ref_hash: string | null;
  at_sec: number;
  status: "Delivering" | "Delivered" | "Failed";
}

export interface PayoutRequest {
  id: string;
  kind: PayoutKind;
  beneficiary: string;
  reference: string;
  usdc: string;
  inr_paise: string | null;
  rate_ppu: number | null;
  utr_hash: string | null;
  failure_reason: string | null;
  created_sec: number;
  status: "Pending" | "Processing" | "Paid" | "Failed";
}

export interface GatewayLimits {
  spread_bps: number;
  min_rate_ppu: number;
  max_rate_ppu: number;
  max_payin_paise: string;
  daily_payin_paise: string;
  max_payout_usdc: string;
}

export interface FloatView {
  free: string;
  payout_pending: string;
  refunds_total: string;
  daily_payin_day: number;
  daily_payin_paise: string;
}

export function inrViews(view: Viewer, inr: string) {
  return {
    config: () =>
      view(inr, "get_config", {}) as Promise<{
        owner: string;
        credit: string;
        requires_tee: boolean;
        paused_payins: boolean;
      }>,
    limits: () => view(inr, "get_limits", {}) as Promise<GatewayLimits>,
    float: () => view(inr, "get_float", {}) as Promise<FloatView>,
    receipt: (payment_ref_hash: string) =>
      view(inr, "get_receipt", { payment_ref_hash }) as Promise<PayinReceipt | null>,
    payinsByHandle: (handle: string, from = "0", limit = 100) =>
      view(inr, "get_payins_by_handle", { handle, from, limit }) as Promise<[string, PayinReceipt][]>,
    payout: (payout_id: string) => view(inr, "get_payout", { payout_id }) as Promise<PayoutRequest | null>,
    pendingPayouts: (from = "0", limit = 100) =>
      view(inr, "get_pending_payouts", { from, limit }) as Promise<PayoutRequest[]>,
    beneficiaryBlob: (account_id: string) =>
      view(inr, "get_beneficiary_blob", { account_id }) as Promise<string | null>,
    agent: (account_id: string) => view(inr, "get_agent", { account_id }) as Promise<AgentView | null>,
  };
}
