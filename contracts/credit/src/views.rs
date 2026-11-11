use crate::*;
use near_sdk::json_types::{U128, U64};

#[near]
impl Credit {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            guardian: self.guardian.clone(),
            token: self.token.clone(),
            factory: self.factory.clone(),
            inr_gateway: self.inr_gateway.clone(),
            requires_tee: self.agents.requires_tee,
            paused_new_lending: self.paused_new_lending,
            time: self.time.clone(),
            policy_version: self.policy.version,
            pending_policy_version: self.pending_policy.as_ref().map(|(p, _)| p.version),
            pending_policy_ready_sec: self.pending_policy.as_ref().map(|(_, t)| U64(*t)),
        }
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_vault(&self) -> VaultView {
        let total_assets = self.total_assets();
        let total_shares = self.shares.total_supply;
        let utilization_bps = ((self.outstanding_principal + self.reserved) * 10_000)
            .checked_div(total_assets)
            .map_or(0, |u| u.min(10_000) as u16);
        VaultView {
            cash: U128(self.cash),
            reserved: U128(self.reserved),
            free_cash: U128(self.free_cash()),
            outstanding_principal: U128(self.outstanding_principal),
            provisions: U128(self.provisions),
            reserve: U128(self.reserve),
            total_assets: U128(total_assets),
            total_shares: U128(total_shares),
            share_price_1e6: U128(assets_for_shares(1_000_000, total_shares, total_assets)),
            utilization_bps,
            merchant_claimable_total: U128(self.claimable_total),
            in_transit: U128(self.in_transit),
            active_loans: self.active_loans.len() as u64,
        }
    }

    pub fn get_merchant(&self, handle: String) -> Option<MerchantView> {
        self.merchants.get(&handle).map(|m| MerchantView {
            merchant: m.clone(),
            record: self.record(&handle),
            claimable: U128(self.merchant_claimable.get(&handle).copied().unwrap_or(0)),
        })
    }

    pub fn get_merchant_by_account(&self, account_id: AccountId) -> Option<MerchantView> {
        self.handle_of
            .get(&account_id)
            .and_then(|h| self.get_merchant(h.clone()))
    }

    pub fn get_handle_of_settlement(&self, settlement: AccountId) -> Option<String> {
        self.settlement_of.get(&settlement).cloned()
    }

    pub fn get_offer(&self, offer_id: U64) -> Option<Offer> {
        self.offers.get(&offer_id.0).cloned()
    }

    pub fn get_loan(&self, loan_id: U64) -> Option<Loan> {
        self.loans.get(&loan_id.0).cloned()
    }

    pub fn get_active_loans(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Loan> {
        self.active_loans
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .filter_map(|id| self.loans.get(id).cloned())
            .collect()
    }

    pub fn get_record(&self, handle: String) -> Option<CreditRecord> {
        self.records.get(&handle).cloned()
    }

    pub fn get_anchor_owner(
        &self,
        anchor_hash: near_sdk::json_types::Base58CryptoHash,
    ) -> Option<String> {
        self.anchors.get(&anchor_hash).cloned()
    }

    /// Highest settle op id processed for a settlement account (0 if none).
    pub fn get_last_op(&self, settlement: AccountId) -> U64 {
        U64(self.last_op.get(&settlement).copied().unwrap_or(0))
    }

    pub fn get_withdraw_request(&self, request_id: U64) -> Option<WithdrawRequest> {
        self.withdraw_requests.get(&request_id.0).cloned()
    }

    pub fn get_withdraw_requests_of(&self, account_id: AccountId) -> Vec<WithdrawRequest> {
        self.withdraw_requests
            .values()
            .filter(|r| r.owner == account_id)
            .cloned()
            .collect()
    }

    pub fn get_exit_app_cid(&self) -> Option<String> {
        self.exit_app_cid.clone()
    }
}
