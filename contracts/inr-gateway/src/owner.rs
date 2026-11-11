//! Owner controls and views. Pausing pay-ins never blocks payouts, fails or refunds.

use crate::*;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::Promise;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::{promise, GAS_CALLBACK, GAS_FT_TRANSFER, ONE_YOCTO};

#[near]
impl InrGateway {
    pub fn set_limits(&mut self, limits: GatewayLimits) {
        self.assert_owner();
        validate_limits(&limits);
        self.limits = limits;
        emit("limits_set", json!({ "limits": self.limits }));
    }

    pub fn pause_payins(&mut self, paused: bool) {
        self.assert_owner();
        self.paused_payins = paused;
        emit("payins_paused", json!({ "paused": paused }));
    }

    pub fn withdraw_float(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 > 0 && amount.0 <= self.free_float, ERR_FLOAT);
        self.free_float -= amount.0;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                self.owner.clone(),
                amount,
                Some("runway float withdrawal".into()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_float_withdrawn(amount),
            )
    }

    #[private]
    pub fn on_float_withdrawn(&mut self, amount: U128) {
        if !promise::succeeded(0) {
            self.free_float += amount.0;
        }
    }

    // ---------- views ----------

    pub fn get_config(&self) -> GatewayConfigView {
        GatewayConfigView {
            owner: self.owner.clone(),
            token: self.token.clone(),
            credit: self.credit.clone(),
            factory: self.factory.clone(),
            requires_tee: self.agents.requires_tee,
            paused_payins: self.paused_payins,
        }
    }

    pub fn get_limits(&self) -> GatewayLimits {
        self.limits.clone()
    }

    pub fn get_float(&self) -> FloatView {
        FloatView {
            free: U128(self.free_float),
            payout_pending: U128(self.payout_pending),
            refunds_total: U128(self.refunds_total),
            daily_payin_day: self.daily_payin.0,
            daily_payin_paise: U128(self.daily_payin.1),
        }
    }

    pub fn get_receipt(&self, payment_ref_hash: Base58CryptoHash) -> Option<PayinReceipt> {
        let key: CryptoHash = payment_ref_hash.into();
        self.receipts.get(&key).cloned()
    }

    pub fn get_payins_by_handle(
        &self,
        handle: String,
        from: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<(Base58CryptoHash, PayinReceipt)> {
        let Some(list) = self.payins_by_handle.get(&handle) else {
            return vec![];
        };
        list.iter()
            .skip(from.map(|f| f.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(100) as usize)
            .filter_map(|k| {
                self.receipts
                    .get(k)
                    .map(|r| (Base58CryptoHash::from(*k), r.clone()))
            })
            .collect()
    }

    pub fn get_payout(&self, payout_id: U64) -> Option<PayoutRequest> {
        self.payouts.get(&payout_id.0).cloned()
    }

    pub fn get_pending_payouts(&self, from: Option<U64>, limit: Option<u32>) -> Vec<PayoutRequest> {
        self.pending_payouts
            .iter()
            .skip(from.map(|f| f.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(100) as usize)
            .filter_map(|id| self.payouts.get(id).cloned())
            .collect()
    }

    pub fn get_beneficiary_blob(&self, account_id: AccountId) -> Option<String> {
        self.beneficiary_blobs.get(&account_id).cloned()
    }

    pub fn get_refund_claimable(&self, account_id: AccountId) -> U128 {
        U128(
            self.refunds_claimable
                .get(&account_id)
                .copied()
                .unwrap_or(0),
        )
    }
}
