//! Pay-ins: a confirmed UPI payment becomes USDC delivered to its target (design §9A.5).

use crate::*;
use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::json;
use near_sdk::Promise;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::fx::inr_to_usdc;
use runway_shared::{
    promise, FtMsg, GAS_CALLBACK, GAS_FT_TRANSFER, GAS_FT_TRANSFER_CALL_FORWARD, ONE_YOCTO,
};

#[near]
impl InrGateway {
    /// Agent (`InrGateway`) records a confirmed pay-in. Checks, in order: agent and role, not
    /// paused, replay, rate band, per-payment cap, daily cap, float. Then delivers.
    pub fn record_payin(
        &mut self,
        payment_ref_hash: Base58CryptoHash,
        kind: PayinKind,
        inr_paise: U128,
        rate_ppu: u32,
        payer_ref_hash: Option<Base58CryptoHash>,
    ) -> Promise {
        self.assert_gateway_agent();
        require!(!self.paused_payins, ERR_PAYINS_PAUSED);
        let key: CryptoHash = payment_ref_hash.into();
        require!(!self.receipts.contains_key(&key), ERR_PAYIN_REPLAY);
        self.assert_rate(rate_ppu);
        require!(inr_paise.0 > 0, ERR_ZERO_AMOUNT);
        require!(inr_paise.0 <= self.limits.max_payin_paise.0, ERR_PAYIN_CAP);
        let day = Self::today();
        let used_today = if self.daily_payin.0 == day {
            self.daily_payin.1
        } else {
            0
        };
        require!(
            used_today + inr_paise.0 <= self.limits.daily_payin_paise.0,
            ERR_PAYIN_CAP
        );
        let usdc = inr_to_usdc(inr_paise.0, rate_ppu, self.limits.spread_bps);
        require!(usdc > 0, ERR_ZERO_AMOUNT);
        require!(usdc <= self.free_float, ERR_FLOAT);

        // Validate the target before any state changes.
        let (delivery, transfer_call) = match &kind {
            PayinKind::MerchantSale { handle } => {
                let settlement: AccountId = format!("{handle}.{}", self.factory)
                    .parse()
                    .unwrap_or_else(|_| env::panic_str(ERR_BAD_HANDLE));
                (
                    ext_ft::ext(self.token.clone())
                        .with_attached_deposit(ONE_YOCTO)
                        .with_static_gas(GAS_FT_TRANSFER)
                        .ft_transfer(settlement, U128(usdc), Some("runway inr sale".into())),
                    false,
                )
            }
            PayinKind::LenderDeposit { beneficiary } => (
                self.transfer_call_to_credit(
                    usdc,
                    FtMsg::DepositFor {
                        beneficiary: beneficiary.clone(),
                    },
                ),
                true,
            ),
            PayinKind::Repayment { loan_id } => (
                self.transfer_call_to_credit(usdc, FtMsg::Repay { loan_id: *loan_id }),
                true,
            ),
        };

        self.daily_payin = (day, used_today + inr_paise.0);
        self.free_float -= usdc;
        self.receipts.insert(
            key,
            PayinReceipt {
                kind,
                inr_paise,
                rate_ppu,
                spread_bps: self.limits.spread_bps,
                usdc: U128(usdc),
                delivered: U128(0),
                payer_ref_hash,
                at_sec: Self::now_sec(),
                status: PayinStatus::Delivering,
            },
        );

        delivery.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CALLBACK)
                .on_payin_delivered(payment_ref_hash, transfer_call),
        )
    }

    /// Reads the delivery result: all of it for `ft_transfer`, `used` for `ft_transfer_call`. The
    /// undelivered part goes back to the float. Never panics.
    #[private]
    pub fn on_payin_delivered(&mut self, payment_ref_hash: Base58CryptoHash, transfer_call: bool) {
        let key: CryptoHash = payment_ref_hash.into();
        let Some(mut r) = self.receipts.get(&key).cloned() else {
            return;
        };
        if r.status != PayinStatus::Delivering {
            return;
        }
        let usdc = r.usdc.0;
        let delivered = if transfer_call {
            promise::result_u128(0).unwrap_or(0).min(usdc)
        } else if promise::succeeded(0) {
            usdc
        } else {
            0
        };
        self.free_float += usdc - delivered;
        r.delivered = U128(delivered);
        r.status = if delivered > 0 {
            PayinStatus::Delivered
        } else {
            PayinStatus::Failed
        };
        if r.status == PayinStatus::Delivered {
            if let PayinKind::MerchantSale { handle } = &r.kind {
                let mut list = self
                    .payins_by_handle
                    .get(handle)
                    .cloned()
                    .unwrap_or_default();
                list.push(key);
                self.payins_by_handle.insert(handle.clone(), list);
            }
        }
        emit(
            "inr_payin",
            json!({
                "payment_ref_hash": payment_ref_hash,
                "kind": r.kind,
                "inr_paise": r.inr_paise,
                "rate_ppu": r.rate_ppu,
                "usdc": r.usdc,
                "delivered": r.delivered,
                "status": r.status,
            }),
        );
        self.receipts.insert(key, r);
    }
}

impl InrGateway {
    fn transfer_call_to_credit(&self, usdc: u128, msg: FtMsg) -> Promise {
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER_CALL_FORWARD)
            .ft_transfer_call(self.credit.clone(), U128(usdc), None, msg.to_json())
    }
}
