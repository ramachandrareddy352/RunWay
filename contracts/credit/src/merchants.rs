//! Merchant onboarding, payout account and payout mode (design §6.1, §9A.6).

use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{Gas, Promise};
use runway_shared::events::emit;
use runway_shared::ext::{ext_factory, ext_ft};
use runway_shared::{
    promise, AgentRole, PayoutMode, GAS_CALLBACK, GAS_FT_TRANSFER, GAS_VIEW, ONE_YOCTO,
};

const GAS_CREATE_SETTLEMENT: Gas = Gas::from_tgas(120);

pub(crate) fn validate_handle(handle: &str) {
    require!(
        (2..=32).contains(&handle.len())
            && handle
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        ERR_BAD_HANDLE
    );
}

#[near]
impl Credit {
    /// Registers the caller as a merchant and creates `<handle>.<factory>` (keyless settlement).
    /// Attach `policy.merchant_registration_deposit` yoctoNEAR (forwarded to the factory).
    #[payable]
    pub fn register_merchant(&mut self, handle: String) -> Promise {
        validate_handle(&handle);
        let caller = env::predecessor_account_id();
        require!(
            !self.handle_of.contains_key(&caller),
            ERR_ALREADY_REGISTERED
        );
        require!(
            !self.merchants.contains_key(&handle) && !self.pending_handles.contains_key(&handle),
            ERR_HANDLE_TAKEN
        );
        let deposit = env::attached_deposit();
        require!(
            deposit.as_yoctonear() >= self.policy.merchant_registration_deposit.0,
            ERR_DEPOSIT_LOW
        );
        self.pending_handles.insert(handle.clone(), caller.clone());
        ext_factory::ext(self.factory.clone())
            .with_attached_deposit(deposit)
            .with_static_gas(GAS_CREATE_SETTLEMENT)
            .create_settlement(handle.clone(), caller.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_settlement_created(handle, caller),
            )
    }

    #[private]
    pub fn on_settlement_created(&mut self, handle: String, payout: AccountId) -> bool {
        self.pending_handles.remove(&handle);
        if promise::result_bool(0) != Some(true) {
            emit(
                "merchant_registration_failed",
                json!({ "handle": handle, "payout": payout }),
            );
            return false;
        }
        let settlement: AccountId = format!("{handle}.{}", self.factory)
            .parse()
            .unwrap_or_else(|_| env::panic_str(ERR_BAD_HANDLE));
        let now = now_sec();
        self.merchants.insert(
            handle.clone(),
            Merchant {
                handle: handle.clone(),
                payout: payout.clone(),
                settlement: settlement.clone(),
                payout_mode: PayoutMode::Usdc,
                created_sec: now,
                frozen: false,
                active_loan: None,
                open_offer: None,
                anchor: None,
            },
        );
        self.handle_of.insert(payout.clone(), handle.clone());
        self.settlement_of
            .insert(settlement.clone(), handle.clone());
        self.records.insert(
            handle.clone(),
            CreditRecord {
                member_since_sec: now,
                ..Default::default()
            },
        );
        emit(
            "merchant_registered",
            json!({ "handle": handle, "payout": payout, "settlement": settlement }),
        );
        true
    }

    /// Changes the payout account. The new account must be registered with the USDC token.
    #[payable]
    pub fn update_payout(&mut self, new_payout: AccountId) -> Promise {
        assert_one_yocto();
        let handle = self.handle_of_caller();
        require!(
            !self.handle_of.contains_key(&new_payout),
            ERR_ALREADY_REGISTERED
        );
        ext_ft::ext(self.token.clone())
            .with_static_gas(GAS_VIEW)
            .storage_balance_of(new_payout.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout_checked(handle, new_payout),
            )
    }

    #[private]
    pub fn on_payout_checked(&mut self, handle: String, new_payout: AccountId) -> bool {
        let registered = promise::result_bytes(0)
            .map(|b| !b.is_empty() && b.as_slice() != b"null")
            .unwrap_or(false);
        require!(registered, ERR_NOT_REGISTERED_STORAGE);
        require!(
            !self.handle_of.contains_key(&new_payout),
            ERR_ALREADY_REGISTERED
        );
        let mut m = self.merchant(&handle);
        let old = m.payout.clone();
        m.payout = new_payout.clone();
        self.merchants.insert(handle.clone(), m);
        self.handle_of.remove(&old);
        self.handle_of.insert(new_payout.clone(), handle.clone());
        emit(
            "payout_updated",
            json!({ "handle": handle, "old": old, "new": new_payout }),
        );
        true
    }

    #[payable]
    pub fn set_payout_mode(&mut self, mode: PayoutMode) {
        assert_one_yocto();
        let handle = self.handle_of_caller();
        if mode == PayoutMode::Inr {
            require!(self.inr_gateway.is_some(), ERR_NO_GATEWAY);
        }
        let mut m = self.merchant(&handle);
        m.payout_mode = mode;
        self.merchants.insert(handle.clone(), m);
        emit("payout_mode_set", json!({ "handle": handle, "mode": mode }));
    }

    /// Pays out failed forwards that became claimable. Always USDC to the payout account.
    pub fn claim_payout(&mut self) -> Promise {
        let handle = self.handle_of_caller();
        let amount = self.merchant_claimable.get(&handle).copied().unwrap_or(0);
        require!(amount > 0, ERR_NOTHING_TO_CLAIM);
        self.merchant_claimable.insert(handle.clone(), 0);
        self.claimable_total -= amount;
        self.in_transit += amount;
        let payout = self.merchant(&handle).payout;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(payout, U128(amount), Some("runway claim".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_claim_paid(handle, U128(amount)),
            )
    }

    #[private]
    pub fn on_claim_paid(&mut self, handle: String, amount: U128) {
        self.in_transit -= amount.0;
        if !promise::succeeded(0) {
            self.add_claimable(&handle, amount.0);
        }
    }

    /// Risk agent: blocks new offers and accepts for a merchant. Cannot move funds.
    pub fn freeze_merchant(&mut self, handle: String, reason: String) {
        self.agents
            .require_role(&env::predecessor_account_id(), AgentRole::Risk);
        let mut m = self.merchant(&handle);
        m.frozen = true;
        self.merchants.insert(handle.clone(), m);
        emit(
            "merchant_frozen",
            json!({ "handle": handle, "reason": reason }),
        );
    }

    pub fn unfreeze_merchant(&mut self, handle: String) {
        self.assert_owner();
        let mut m = self.merchant(&handle);
        m.frozen = false;
        self.merchants.insert(handle.clone(), m);
        emit("merchant_unfrozen", json!({ "handle": handle }));
    }
}

impl Credit {
    pub(crate) fn handle_of_caller(&self) -> String {
        self.handle_of
            .get(&env::predecessor_account_id())
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_MERCHANT))
    }
}
