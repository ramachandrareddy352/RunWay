//! `ft_on_transfer` router (design §6.3, §7.4): deposits, reserve seeding, repayments and
//! settlement operations. Settle messages never return a partial amount: either the whole
//! transfer is processed (returns 0) or the call panics and the token refunds everything.

use crate::*;
use near_contract_standards::fungible_token::events::FtMint;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::PromiseOrValue;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::{
    promise, FtMsg, PayoutKind, PayoutMode, GAS_CALLBACK, GAS_FT_TRANSFER,
    GAS_FT_TRANSFER_CALL_FORWARD, ONE_YOCTO,
};

#[near]
impl Credit {
    /// NEP-141 receiver for USDC only.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, ERR_NOT_TOKEN);
        let amount = amount.0;
        let msg = FtMsg::parse(&msg).unwrap_or_else(|| env::panic_str(ERR_BAD_MSG));
        match msg {
            FtMsg::Deposit => self.internal_deposit(sender_id, amount),
            FtMsg::DepositFor { beneficiary } => self.internal_deposit(beneficiary, amount),
            FtMsg::SeedReserve => {
                require!(sender_id == self.owner, ERR_NOT_OWNER);
                self.reserve += amount;
                emit("reserve_seeded", json!({ "amount": U128(amount) }));
                PromiseOrValue::Value(U128(0))
            }
            FtMsg::Repay { loan_id } => {
                let applied = self.apply_repayment(loan_id.0, None, amount);
                PromiseOrValue::Value(U128(amount - applied))
            }
            FtMsg::Settle {
                op_id,
                loan_id,
                repay,
                payout,
            } => self.internal_settle(
                sender_id,
                amount,
                op_id.0,
                loan_id.map(|l| l.0),
                repay.0,
                payout.0,
            ),
            FtMsg::FundFloat | FtMsg::InrPayout { .. } => env::panic_str(ERR_BAD_MSG),
        }
    }

    #[private]
    pub fn on_forwarded(&mut self, handle: String, amount: U128, mode: PayoutMode) {
        self.in_transit -= amount.0;
        let delivered = match mode {
            PayoutMode::Usdc => {
                if promise::succeeded(0) {
                    amount.0
                } else {
                    0
                }
            }
            PayoutMode::Inr => promise::result_u128(0).unwrap_or(0).min(amount.0),
        };
        let shortfall = amount.0 - delivered;
        if shortfall > 0 {
            self.add_claimable(&handle, shortfall);
            emit(
                "payout_claimable",
                json!({ "handle": handle, "amount": U128(shortfall) }),
            );
        }
    }
}

impl Credit {
    fn internal_deposit(&mut self, beneficiary: AccountId, amount: u128) -> PromiseOrValue<U128> {
        if amount == 0 || !self.shares.accounts.contains_key(&beneficiary) {
            emit(
                "deposit_refunded",
                json!({ "beneficiary": beneficiary, "amount": U128(amount) }),
            );
            return PromiseOrValue::Value(U128(amount));
        }
        let minted = shares_for_deposit(amount, self.shares.total_supply, self.total_assets());
        if minted == 0 {
            return PromiseOrValue::Value(U128(amount));
        }
        self.shares.internal_deposit(&beneficiary, minted);
        self.cash += amount;
        FtMint {
            owner_id: &beneficiary,
            amount: U128(minted),
            memo: Some("vault deposit"),
        }
        .emit();
        emit(
            "vault_deposit",
            json!({ "account": beneficiary, "assets": U128(amount), "shares": U128(minted) }),
        );
        PromiseOrValue::Value(U128(0))
    }

    fn internal_settle(
        &mut self,
        settlement: AccountId,
        amount: u128,
        op_id: u64,
        loan_id: Option<u64>,
        repay: u128,
        payout: u128,
    ) -> PromiseOrValue<U128> {
        #[cfg(feature = "test-hooks")]
        require!(!self.hook_refuse_settle, "test-hook: refusing settle");
        let handle = self
            .settlement_of
            .get(&settlement)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_SETTLEMENT));
        require!(repay + payout == amount, ERR_AMOUNT_MISMATCH);
        let last = self.last_op.get(&settlement).copied().unwrap_or(0);
        require!(op_id > last, ERR_OP_REPLAY);
        self.last_op.insert(settlement.clone(), op_id);

        let applied = match loan_id {
            Some(l) => self.apply_repayment(l, Some(&handle), repay),
            None => 0,
        };
        let merchant_share = payout + (repay - applied);
        if merchant_share > 0 {
            self.forward_to_merchant(&handle, merchant_share);
        }
        emit(
            "settled",
            json!({
                "settlement": settlement, "handle": handle, "op_id": op_id.to_string(),
                "inflow": U128(amount), "repay_applied": U128(applied),
                "excess_to_merchant": U128(repay - applied), "payout": U128(merchant_share),
            }),
        );
        PromiseOrValue::Value(U128(0))
    }

    pub(crate) fn forward_to_merchant(&mut self, handle: &str, amount: u128) {
        let m = self.merchant(handle);
        let transfer = match (m.payout_mode, self.inr_gateway.clone()) {
            (PayoutMode::Inr, Some(gateway)) => {
                let msg = FtMsg::InrPayout {
                    kind: PayoutKind::MerchantShare,
                    beneficiary: m.payout.clone(),
                    reference: handle.to_string(),
                };
                ext_ft::ext(self.token.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER_CALL_FORWARD)
                    .ft_transfer_call(gateway, U128(amount), None, msg.to_json())
            }
            (PayoutMode::Inr, None) => {
                // Gateway was unset after the merchant chose INR: keep it claimable in USDC.
                self.add_claimable(handle, amount);
                return;
            }
            (PayoutMode::Usdc, _) => ext_ft::ext(self.token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(
                    m.payout.clone(),
                    U128(amount),
                    Some("runway payout".to_string()),
                ),
        };
        self.in_transit += amount;
        transfer
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_forwarded(handle.to_string(), U128(amount), m.payout_mode),
            )
            .detach();
    }
}
