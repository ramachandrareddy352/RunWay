use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::{near, require, AccountId};
use runway_shared::errors::*;
use runway_shared::{Grade, PayoutMode, WithdrawPayout, BPS_DENOM};

/// Lending policy (design §7.3). All money values are micro-USDC except
/// `merchant_registration_deposit` (yoctoNEAR). `version` must increase by one on every change.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub version: u32,
    /// Caps by `loans_repaid` (index = min(repaid, 3)) for merchants with an identity anchor.
    pub anchored_caps: Vec<U128>,
    /// Caps by `loans_repaid` for merchants without an identity anchor.
    pub unanchored_caps: Vec<U128>,
    pub min_loan: U128,
    pub fee_bps_min: u16,
    pub fee_bps_max: u16,
    pub repay_bps_min: u16,
    pub repay_bps_max: u16,
    pub max_utilization_bps: u16,
    pub max_exposure_per_merchant: U128,
    /// Daily cap on new loans to merchants with zero repaid loans.
    pub daily_new_merchant_exposure: U128,
    /// Minimum repaid per period, as bps of the total owed.
    pub min_period_repay_bps: u16,
    pub default_after_missed: u8,
    pub delinquency_provision_bps: u16,
    /// Share of fee income that goes to the first-loss reserve.
    pub protocol_fee_share_bps: u16,
    /// yoctoNEAR the merchant attaches to `register_merchant` (forwarded to the factory).
    pub merchant_registration_deposit: U128,
}

impl Policy {
    pub fn validate(&self) {
        let bps_ok = |v: u16| (v as u128) <= BPS_DENOM;
        require!(
            self.anchored_caps.len() == 4 && self.unanchored_caps.len() == 4,
            ERR_POLICY_INVALID
        );
        require!(
            self.fee_bps_min <= self.fee_bps_max
                && self.repay_bps_min <= self.repay_bps_max
                && self.repay_bps_min > 0
                && bps_ok(self.fee_bps_max)
                && bps_ok(self.repay_bps_max)
                && bps_ok(self.max_utilization_bps)
                && bps_ok(self.min_period_repay_bps)
                && bps_ok(self.delinquency_provision_bps)
                && bps_ok(self.protocol_fee_share_bps)
                && self.default_after_missed > 0
                && self.min_loan.0 > 0,
            ERR_POLICY_INVALID
        );
    }

    pub fn cap(&self, anchored: bool, loans_repaid: u32) -> u128 {
        let caps = if anchored {
            &self.anchored_caps
        } else {
            &self.unanchored_caps
        };
        caps[(loans_repaid.min(3)) as usize].0
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TimeParams {
    pub period_sec: u64,
    pub withdraw_cooldown_sec: u64,
    pub offer_ttl_sec: u64,
    pub policy_timelock_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Merchant {
    pub handle: String,
    pub payout: AccountId,
    pub settlement: AccountId,
    pub payout_mode: PayoutMode,
    pub created_sec: u64,
    pub frozen: bool,
    pub active_loan: Option<U64>,
    pub open_offer: Option<U64>,
    pub anchor: Option<Base58CryptoHash>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct CreditRecord {
    pub loans_repaid: u32,
    pub loans_defaulted: u32,
    pub total_borrowed: U128,
    pub total_repaid: U128,
    pub member_since_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfferStatus {
    Open,
    Accepted,
    Superseded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: U64,
    pub handle: String,
    pub limit: U128,
    pub fee_bps: u16,
    pub repay_bps: u16,
    pub grade: Grade,
    pub anchor_hash: Option<Base58CryptoHash>,
    pub inputs_commitment: Base58CryptoHash,
    pub llm_receipt_hash: Option<Base58CryptoHash>,
    pub agent: AccountId,
    pub measurements_hash: String,
    pub policy_version: u32,
    pub created_sec: u64,
    pub expires_at_sec: u64,
    pub status: OfferStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoanStatus {
    PendingTerms,
    PendingTransfer,
    Active,
    Delinquent,
    Repaid,
    Defaulted,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Loan {
    pub id: U64,
    pub handle: String,
    pub offer_id: U64,
    pub principal: U128,
    pub fee_bps: u16,
    pub fee: U128,
    /// principal + fee
    pub owed: U128,
    pub repaid: U128,
    pub principal_repaid: U128,
    pub repay_bps: u16,
    pub payout_mode: PayoutMode,
    pub status: LoanStatus,
    pub disbursed_sec: u64,
    pub period_end_sec: u64,
    pub repaid_in_period: U128,
    pub missed: u8,
    pub provisioned: U128,
    pub written_off: U128,
    pub reserve_drawn: U128,
    pub recovered_lenders: U128,
    pub recovered_reserve: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WithdrawStatus {
    Open,
    Claiming,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct WithdrawRequest {
    pub id: U64,
    pub owner: AccountId,
    pub shares: U128,
    pub ready_at_sec: u64,
    pub payout: WithdrawPayout,
    pub status: WithdrawStatus,
}

// ---------------- views ----------------

#[near(serializers = [json])]
pub struct VaultView {
    pub cash: U128,
    pub reserved: U128,
    pub free_cash: U128,
    pub outstanding_principal: U128,
    pub provisions: U128,
    pub reserve: U128,
    pub total_assets: U128,
    pub total_shares: U128,
    /// micro-USDC redeemable for 1.000000 share (1_000_000 units)
    pub share_price_1e6: U128,
    pub utilization_bps: u16,
    pub merchant_claimable_total: U128,
    pub in_transit: U128,
    pub active_loans: u64,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub token: AccountId,
    pub factory: AccountId,
    pub inr_gateway: Option<AccountId>,
    pub requires_tee: bool,
    pub paused_new_lending: bool,
    pub time: TimeParams,
    pub policy_version: u32,
    pub pending_policy_version: Option<u32>,
    pub pending_policy_ready_sec: Option<U64>,
}

#[near(serializers = [json])]
pub struct MerchantView {
    pub merchant: Merchant,
    pub record: CreditRecord,
    pub claimable: U128,
}
