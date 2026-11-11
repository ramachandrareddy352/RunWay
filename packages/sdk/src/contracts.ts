// Typed views and call builders for the Runway contracts. Transport-agnostic: pass any `Viewer`
// (dual-RPC `viewAgreed`, near-workspaces in the sandbox, or a wallet provider in the web app).

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
    agent: (account_id: string) =>
      view(credit, "get_agent", { account_id }) as Promise<Record<string, unknown> | null>,
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

/** `ft_on_transfer` message strings (BUILD_PLAN §9.2). */
export const ftMsg = {
  deposit: () => JSON.stringify({ action: "deposit" }),
  depositFor: (beneficiary: string) => JSON.stringify({ action: "deposit_for", beneficiary }),
  seedReserve: () => JSON.stringify({ action: "seed_reserve" }),
  repay: (loanId: string) => JSON.stringify({ action: "repay", loan_id: loanId }),
};
