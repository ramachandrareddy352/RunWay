//! Runway credit contract (design §6–§7, §9A.6; BUILD_PLAN T1.5).
//!
//! - USDC vault with `runUSDC` share token (NEP-141/145), virtual-offset share math, withdrawal
//!   cooldown with escrowed shares priced at claim.
//! - Shade-compatible TEE agent registry; offers only from agents whose owner-approved measurements
//!   map to the `Underwriter` role; hard policy bounds re-checked on every offer.
//! - Loan state machine with callback-gated disbursement, period rolling, provisions, default and
//!   capped recoveries.
//! - Router for settlement accounts: applies repayments and forwards the merchant share (USDC, or via
//!   the INR gateway in `Inr` payout mode), with a monotonic per-settlement op receipt (`last_op`).

use near_contract_standards::fungible_token::FungibleToken;
use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};
use runway_shared::agents::AgentRegistry;
use runway_shared::errors::*;
use runway_shared::{ONE_YOCTO, VIRTUAL_OFFSET};

mod agents_api;
mod ft;
mod loans;
mod merchants;
mod offers;
mod owner;
mod router;
pub mod types;
mod vault;
mod views;

#[cfg(test)]
mod tests;

pub use types::*;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Shares,
    Withdraws,
    Anchors,
    Merchants,
    HandleOf,
    SettlementOf,
    PendingHandles,
    Records,
    Offers,
    Loans,
    ActiveLoans,
    LastOp,
    Claimable,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Credit {
    pub(crate) owner: AccountId,
    pub(crate) guardian: AccountId,
    pub(crate) token: AccountId,
    pub(crate) factory: AccountId,
    pub(crate) inr_gateway: Option<AccountId>,
    pub(crate) policy: Policy,
    pub(crate) time: TimeParams,
    pub(crate) pending_policy: Option<(Policy, u64)>,
    pub(crate) paused_new_lending: bool,
    pub(crate) exit_app_cid: Option<String>,

    // vault
    pub(crate) shares: FungibleToken,
    /// Lender-owned USDC held by the contract (includes `reserved`).
    pub(crate) cash: u128,
    /// Part of `cash` committed to loans whose disbursement is in flight.
    pub(crate) reserved: u128,
    pub(crate) outstanding_principal: u128,
    pub(crate) provisions: u128,
    /// First-loss reserve (not lender-owned).
    pub(crate) reserve: u128,
    pub(crate) claimable_total: u128,
    /// Merchant shares forwarded but not yet confirmed.
    pub(crate) in_transit: u128,
    pub(crate) withdraw_requests: IterableMap<u64, WithdrawRequest>,

    // agents and identity
    pub(crate) agents: AgentRegistry,
    pub(crate) anchors: LookupMap<Base58CryptoHash, String>,

    // merchants and credit
    pub(crate) merchants: LookupMap<String, Merchant>,
    pub(crate) handle_of: LookupMap<AccountId, String>,
    pub(crate) settlement_of: LookupMap<AccountId, String>,
    pub(crate) pending_handles: LookupMap<String, AccountId>,
    pub(crate) records: LookupMap<String, CreditRecord>,
    pub(crate) offers: LookupMap<u64, Offer>,
    pub(crate) loans: LookupMap<u64, Loan>,
    pub(crate) active_loans: IterableSet<u64>,
    pub(crate) last_op: LookupMap<AccountId, u64>,
    pub(crate) merchant_claimable: LookupMap<String, u128>,
    pub(crate) next_id: u64,
    /// (day index, amount) of new loans to merchants with zero repaid loans.
    pub(crate) new_merchant_exposure: (u64, u128),

    #[cfg(feature = "test-hooks")]
    pub(crate) hook_refuse_settle: bool,
}

#[near]
impl Credit {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        token: AccountId,
        factory: AccountId,
        policy: Policy,
        time: TimeParams,
        requires_tee: bool,
        attestation_expiration_time_ms: U64,
    ) -> Self {
        policy.validate();
        require!(
            time.period_sec > 0 && time.offer_ttl_sec > 0,
            ERR_POLICY_INVALID
        );
        let mut shares = FungibleToken::new(StorageKey::Shares);
        // The contract holds escrowed shares of pending withdrawals.
        shares.internal_register_account(&env::current_account_id());
        Self {
            owner,
            guardian,
            token,
            factory,
            inr_gateway: None,
            policy,
            time,
            pending_policy: None,
            paused_new_lending: false,
            exit_app_cid: None,
            shares,
            cash: 0,
            reserved: 0,
            outstanding_principal: 0,
            provisions: 0,
            reserve: 0,
            claimable_total: 0,
            in_transit: 0,
            withdraw_requests: IterableMap::new(StorageKey::Withdraws),
            agents: AgentRegistry::new(b"ag", requires_tee, attestation_expiration_time_ms.0),
            anchors: LookupMap::new(StorageKey::Anchors),
            merchants: LookupMap::new(StorageKey::Merchants),
            handle_of: LookupMap::new(StorageKey::HandleOf),
            settlement_of: LookupMap::new(StorageKey::SettlementOf),
            pending_handles: LookupMap::new(StorageKey::PendingHandles),
            records: LookupMap::new(StorageKey::Records),
            offers: LookupMap::new(StorageKey::Offers),
            loans: LookupMap::new(StorageKey::Loans),
            active_loans: IterableSet::new(StorageKey::ActiveLoans),
            last_op: LookupMap::new(StorageKey::LastOp),
            merchant_claimable: LookupMap::new(StorageKey::Claimable),
            next_id: 1,
            new_merchant_exposure: (0, 0),
            #[cfg(feature = "test-hooks")]
            hook_refuse_settle: false,
        }
    }
}

// ---------------- internal helpers ----------------

pub(crate) fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

pub(crate) fn assert_one_yocto() {
    require!(env::attached_deposit() == ONE_YOCTO, ERR_ONE_YOCTO);
}

/// shares = floor(amount × (S + V) / (A + V))
pub fn shares_for_deposit(amount: u128, total_shares: u128, total_assets: u128) -> u128 {
    amount * (total_shares + VIRTUAL_OFFSET) / (total_assets + VIRTUAL_OFFSET)
}

/// assets = floor(shares × (A + V) / (S + V))
pub fn assets_for_shares(shares: u128, total_shares: u128, total_assets: u128) -> u128 {
    shares * (total_assets + VIRTUAL_OFFSET) / (total_shares + VIRTUAL_OFFSET)
}

/// ceil(a × b / c)
pub(crate) fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    (a * b).div_ceil(c)
}

impl Credit {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, ERR_NOT_OWNER);
    }

    pub(crate) fn total_assets(&self) -> u128 {
        (self.cash + self.outstanding_principal).saturating_sub(self.provisions)
    }

    pub(crate) fn free_cash(&self) -> u128 {
        self.cash.saturating_sub(self.reserved)
    }

    pub(crate) fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(crate) fn merchant(&self, handle: &str) -> Merchant {
        self.merchants
            .get(handle)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_MERCHANT))
    }

    pub(crate) fn record(&self, handle: &str) -> CreditRecord {
        self.records.get(handle).cloned().unwrap_or_default()
    }

    pub(crate) fn add_claimable(&mut self, handle: &str, amount: u128) {
        let cur = self.merchant_claimable.get(handle).copied().unwrap_or(0);
        self.merchant_claimable
            .insert(handle.to_string(), cur + amount);
        self.claimable_total += amount;
    }
}
