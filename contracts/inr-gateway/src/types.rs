//! Gateway types (design §9A.5, BUILD_PLAN §9.8). JSON amounts are decimal strings.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::{near, AccountId};
use runway_shared::PayoutKind;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct GatewayLimits {
    pub spread_bps: u16,
    /// Allowed rate band, paise per 1 USDC.
    pub min_rate_ppu: u32,
    pub max_rate_ppu: u32,
    pub max_payin_paise: U128,
    pub daily_payin_paise: U128,
    pub max_payout_usdc: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PayinKind {
    MerchantSale { handle: String },
    LenderDeposit { beneficiary: AccountId },
    Repayment { loan_id: U64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayinStatus {
    Delivering,
    Delivered,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayinReceipt {
    pub kind: PayinKind,
    pub inr_paise: U128,
    pub rate_ppu: u32,
    pub spread_bps: u16,
    /// USDC sent toward the target.
    pub usdc: U128,
    /// USDC the target kept (an `ft_transfer_call` may return part of it; that part goes back to
    /// the float).
    pub delivered: U128,
    pub payer_ref_hash: Option<Base58CryptoHash>,
    pub at_sec: u64,
    pub status: PayinStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    Pending,
    Processing,
    Paid,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayoutRequest {
    pub id: U64,
    pub kind: PayoutKind,
    pub beneficiary: AccountId,
    pub reference: String,
    pub usdc: U128,
    pub inr_paise: Option<U128>,
    pub rate_ppu: Option<u32>,
    pub utr_hash: Option<Base58CryptoHash>,
    pub failure_reason: Option<String>,
    pub created_sec: u64,
    pub status: PayoutStatus,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct GatewayConfigView {
    pub owner: AccountId,
    pub token: AccountId,
    pub credit: AccountId,
    pub factory: AccountId,
    pub requires_tee: bool,
    pub paused_payins: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct FloatView {
    pub free: U128,
    pub payout_pending: U128,
    pub refunds_total: U128,
    pub daily_payin_day: u64,
    pub daily_payin_paise: U128,
}
