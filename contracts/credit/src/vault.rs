//! Lender withdrawals (design §6.7): shares move to escrow, wait `withdraw_cooldown_sec`, then are
//! priced at claim time. Escrowed shares keep bearing losses, so lenders cannot exit ahead of a
//! default at the old price.

use crate::*;
use near_contract_standards::fungible_token::events::FtBurn;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::Promise;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::{
    promise, FtMsg, PayoutKind, WithdrawPayout, GAS_CALLBACK, GAS_FT_TRANSFER,
    GAS_FT_TRANSFER_CALL_FORWARD, ONE_YOCTO,
};

#[near]
impl Credit {
    #[payable]
    pub fn request_withdraw(&mut self, shares: U128, payout: Option<WithdrawPayout>) -> U64 {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, ERR_ZERO_AMOUNT);
        require!(
            self.shares.accounts.get(&owner).unwrap_or(0) >= shares,
            ERR_INSUFFICIENT_SHARES
        );
        let payout = payout.unwrap_or_default();
        if payout == WithdrawPayout::Inr {
            require!(self.inr_gateway.is_some(), ERR_NO_GATEWAY);
        }
        let me = env::current_account_id();
        self.shares
            .internal_transfer(&owner, &me, shares, Some("withdraw escrow".to_string()));
        let id = self.next_id();
        let ready_at_sec = now_sec() + self.time.withdraw_cooldown_sec;
        self.withdraw_requests.insert(
            id,
            WithdrawRequest {
                id: U64(id),
                owner: owner.clone(),
                shares: U128(shares),
                ready_at_sec,
                payout,
                status: WithdrawStatus::Open,
            },
        );
        emit(
            "withdraw_requested",
            json!({ "request_id": U64(id), "owner": owner, "shares": U128(shares), "ready_at_sec": ready_at_sec }),
        );
        U64(id)
    }

    pub fn claim_withdraw(&mut self, request_id: U64) -> Promise {
        let mut r = self
            .withdraw_requests
            .get(&request_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND));
        require!(
            r.owner == env::predecessor_account_id(),
            ERR_NOT_REQUEST_OWNER
        );
        require!(r.status == WithdrawStatus::Open, ERR_REQUEST_STATE);
        require!(now_sec() >= r.ready_at_sec, ERR_COOLDOWN);
        let assets = assets_for_shares(r.shares.0, self.shares.total_supply, self.total_assets());
        require!(assets > 0, ERR_ZERO_AMOUNT);
        require!(self.free_cash() >= assets, ERR_LIQUIDITY);
        let me = env::current_account_id();
        self.shares.internal_withdraw(&me, r.shares.0);
        FtBurn {
            owner_id: &me,
            amount: r.shares,
            memo: Some("withdraw claim"),
        }
        .emit();
        self.cash -= assets;
        r.status = WithdrawStatus::Claiming;
        self.withdraw_requests.insert(request_id.0, r.clone());
        let transfer = match r.payout {
            WithdrawPayout::Usdc => ext_ft::ext(self.token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(
                    r.owner.clone(),
                    U128(assets),
                    Some("runway withdraw".to_string()),
                ),
            WithdrawPayout::Inr => {
                let gateway = self
                    .inr_gateway
                    .clone()
                    .unwrap_or_else(|| env::panic_str(ERR_NO_GATEWAY));
                let msg = FtMsg::InrPayout {
                    kind: PayoutKind::LenderWithdrawal,
                    beneficiary: r.owner.clone(),
                    reference: request_id.0.to_string(),
                };
                ext_ft::ext(self.token.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER_CALL_FORWARD)
                    .ft_transfer_call(gateway, U128(assets), None, msg.to_json())
            }
        };
        transfer.then(
            Self::ext(me)
                .with_static_gas(GAS_CALLBACK)
                .on_withdraw_paid(request_id, U128(assets)),
        )
    }

    #[private]
    pub fn on_withdraw_paid(&mut self, request_id: U64, assets: U128) {
        let Some(mut r) = self.withdraw_requests.get(&request_id.0).cloned() else {
            return;
        };
        if r.status != WithdrawStatus::Claiming {
            return;
        }
        let delivered = match r.payout {
            WithdrawPayout::Usdc => {
                if promise::succeeded(0) {
                    assets.0
                } else {
                    0
                }
            }
            WithdrawPayout::Inr => promise::result_u128(0).unwrap_or(0).min(assets.0),
        };
        if delivered == assets.0 {
            self.withdraw_requests.remove(&request_id.0);
            emit(
                "withdraw_claimed",
                json!({ "request_id": request_id, "owner": r.owner, "assets": assets, "shares": r.shares }),
            );
            return;
        }
        // Refused (or partially used): the undelivered tokens came back. Restore that part.
        let back = assets.0 - delivered;
        let restore_shares = r.shares.0 * back / assets.0;
        self.cash += back;
        self.shares
            .internal_deposit(&env::current_account_id(), restore_shares);
        r.shares = U128(restore_shares);
        r.status = WithdrawStatus::Open;
        if restore_shares == 0 {
            self.withdraw_requests.remove(&request_id.0);
        } else {
            self.withdraw_requests.insert(request_id.0, r);
        }
        emit(
            "withdraw_failed",
            json!({ "request_id": request_id, "restored_shares": U128(restore_shares) }),
        );
    }

    pub fn cancel_withdraw(&mut self, request_id: U64) {
        let r = self
            .withdraw_requests
            .get(&request_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND));
        require!(
            r.owner == env::predecessor_account_id(),
            ERR_NOT_REQUEST_OWNER
        );
        require!(r.status == WithdrawStatus::Open, ERR_REQUEST_STATE);
        let me = env::current_account_id();
        self.shares.internal_transfer(
            &me,
            &r.owner,
            r.shares.0,
            Some("withdraw cancel".to_string()),
        );
        self.withdraw_requests.remove(&request_id.0);
        emit("withdraw_cancelled", json!({ "request_id": request_id }));
    }
}
