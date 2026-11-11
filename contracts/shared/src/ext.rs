//! Cross-contract interfaces. Return types are omitted on purpose: callers read results
//! in callbacks through `crate::promise` helpers.

#![allow(clippy::too_many_arguments)]

use near_sdk::{ext_contract, json_types::U128, json_types::U64, AccountId};

#[ext_contract(ext_ft)]
pub trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    );
    fn ft_balance_of(&self, account_id: AccountId);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn storage_balance_of(&self, account_id: AccountId);
}

#[ext_contract(ext_settlement)]
pub trait ExtSettlement {
    fn set_terms(&mut self, loan_id: U64, repay_bps: u16);
    fn clear_terms(&mut self, loan_id: U64);
}

#[ext_contract(ext_credit)]
pub trait ExtCredit {
    fn get_last_op(&self, settlement: AccountId);
}

#[ext_contract(ext_factory)]
pub trait ExtFactory {
    fn create_settlement(&mut self, handle: String, refund_to: AccountId);
}
