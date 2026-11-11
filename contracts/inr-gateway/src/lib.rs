//! Runway INR gateway (design §9A.5, BUILD_PLAN T4b.1).
//!
//! The vault, shares and loans stay in USDC. This contract is the only place INR meets USDC:
//! - **Pay-ins:** an attested agent with role `InrGateway` reports a confirmed UPI payment
//!   (`record_payin`). The contract converts it at an in-band rate and delivers USDC from its float
//!   to the target: a merchant's settlement account, a lender deposit, or a loan repayment.
//! - **Payouts:** the credit contract (or a holder off-ramping their own USDC) sends USDC with an
//!   `InrPayout` message. The agent pays rupees off-chain, then `complete_payout` moves that USDC
//!   into the float, or `fail_payout` refunds it.
//!
//! Invariant G-I1: `usdc.balance(self) ≥ free_float + payout_pending + refunds_total`.

use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, CryptoHash, PanicOnDefault};
use runway_shared::agents::AgentRegistry;
use runway_shared::errors::*;

mod agents_api;
mod owner;
mod payin;
mod payout;
pub mod types;

#[cfg(test)]
mod tests;

pub use types::*;

pub(crate) const MAX_BLOB_LEN: usize = 2_048;
pub(crate) const MAX_REFERENCE_LEN: usize = 64;
const SECONDS_PER_DAY: u64 = 86_400;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Receipts,
    PayinsByHandle,
    Payouts,
    PendingPayouts,
    Blobs,
    Refunds,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct InrGateway {
    pub(crate) owner: AccountId,
    pub(crate) token: AccountId,
    pub(crate) credit: AccountId,
    /// Settlement accounts are `<handle>.<factory>`.
    pub(crate) factory: AccountId,
    pub(crate) agents: AgentRegistry,
    pub(crate) limits: GatewayLimits,
    pub(crate) paused_payins: bool,
    /// USDC available to fund pay-ins.
    pub(crate) free_float: u128,
    /// USDC held for Pending/Processing payouts.
    pub(crate) payout_pending: u128,
    pub(crate) refunds_claimable: LookupMap<AccountId, u128>,
    pub(crate) refunds_total: u128,
    pub(crate) receipts: LookupMap<CryptoHash, PayinReceipt>,
    /// Delivered merchant sales per handle (read by the underwriter).
    pub(crate) payins_by_handle: LookupMap<String, Vec<CryptoHash>>,
    pub(crate) payouts: LookupMap<u64, PayoutRequest>,
    pub(crate) pending_payouts: IterableSet<u64>,
    /// Encrypted payout details (ciphertext only, set by the agent).
    pub(crate) beneficiary_blobs: LookupMap<AccountId, String>,
    /// (day index, paise recorded that day)
    pub(crate) daily_payin: (u64, u128),
    pub(crate) next_payout_id: u64,
}

pub(crate) fn validate_limits(l: &GatewayLimits) {
    require!(
        l.spread_bps < 10_000
            && l.min_rate_ppu > 0
            && l.min_rate_ppu <= l.max_rate_ppu
            && l.max_payin_paise.0 > 0
            && l.daily_payin_paise.0 >= l.max_payin_paise.0
            && l.max_payout_usdc.0 > 0,
        ERR_BAD_LIMITS
    );
}

#[near]
impl InrGateway {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner: AccountId,
        token: AccountId,
        credit: AccountId,
        factory: AccountId,
        limits: GatewayLimits,
        requires_tee: bool,
        attestation_expiration_time_ms: near_sdk::json_types::U64,
    ) -> Self {
        validate_limits(&limits);
        Self {
            owner,
            token,
            credit,
            factory,
            agents: AgentRegistry::new(b"ag", requires_tee, attestation_expiration_time_ms.0),
            limits,
            paused_payins: false,
            free_float: 0,
            payout_pending: 0,
            refunds_claimable: LookupMap::new(StorageKey::Refunds),
            refunds_total: 0,
            receipts: LookupMap::new(StorageKey::Receipts),
            payins_by_handle: LookupMap::new(StorageKey::PayinsByHandle),
            payouts: LookupMap::new(StorageKey::Payouts),
            pending_payouts: IterableSet::new(StorageKey::PendingPayouts),
            beneficiary_blobs: LookupMap::new(StorageKey::Blobs),
            daily_payin: (0, 0),
            next_payout_id: 1,
        }
    }
}

impl InrGateway {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, ERR_NOT_OWNER);
    }

    pub(crate) fn assert_gateway_agent(&self) {
        self.agents.require_role(
            &env::predecessor_account_id(),
            runway_shared::AgentRole::InrGateway,
        );
    }

    pub(crate) fn assert_rate(&self, rate_ppu: u32) {
        require!(
            rate_ppu >= self.limits.min_rate_ppu && rate_ppu <= self.limits.max_rate_ppu,
            ERR_RATE_BAND
        );
    }

    pub(crate) fn today() -> u64 {
        env::block_timestamp() / 1_000_000_000 / SECONDS_PER_DAY
    }

    pub(crate) fn now_sec() -> u64 {
        env::block_timestamp() / 1_000_000_000
    }
}
