//! Rupee payouts funded by USDC sent to the gateway, plus the float itself (design §9A.5).

use crate::*;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{Promise, PromiseOrValue};
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::fx::usdc_to_inr;
use runway_shared::{promise, FtMsg, PayoutKind, GAS_CALLBACK, GAS_FT_TRANSFER, ONE_YOCTO};

#[near]
impl InrGateway {
    /// Token only. `FundFloat` (anyone) adds float. `InrPayout` creates a Pending payout when the
    /// sender is the credit contract, or the beneficiary off-ramping their own USDC. Anything else
    /// is refunded in full.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, ERR_NOT_TOKEN);
        match FtMsg::parse(&msg) {
            Some(FtMsg::FundFloat) => {
                self.free_float += amount.0;
                emit(
                    "float",
                    json!({ "funded": amount, "free": U128(self.free_float) }),
                );
                PromiseOrValue::Value(U128(0))
            }
            Some(FtMsg::InrPayout {
                kind,
                beneficiary,
                reference,
            }) => {
                let allowed = sender_id == self.credit
                    || (kind == PayoutKind::SelfOfframp && beneficiary == sender_id);
                let refuse = if !allowed {
                    Some("sender not allowed")
                } else if amount.0 == 0 || amount.0 > self.limits.max_payout_usdc.0 {
                    Some("amount outside limits")
                } else if reference.len() > MAX_REFERENCE_LEN {
                    Some("reference too long")
                } else {
                    None
                };
                if let Some(reason) = refuse {
                    emit(
                        "payout_refused",
                        json!({ "sender": sender_id, "amount": amount, "reason": reason }),
                    );
                    return PromiseOrValue::Value(amount);
                }
                let id = self.next_payout_id;
                self.next_payout_id += 1;
                let p = PayoutRequest {
                    id: U64(id),
                    kind,
                    beneficiary,
                    reference,
                    usdc: amount,
                    inr_paise: None,
                    rate_ppu: None,
                    utr_hash: None,
                    failure_reason: None,
                    created_sec: Self::now_sec(),
                    status: PayoutStatus::Pending,
                };
                self.payout_pending += amount.0;
                self.pending_payouts.insert(id);
                self.emit_payout(&p);
                self.payouts.insert(id, p);
                PromiseOrValue::Value(U128(0))
            }
            _ => PromiseOrValue::Value(amount),
        }
    }

    /// Agent starts paying rupees. The ₹ amount must equal the conversion at `rate_ppu`.
    pub fn start_payout(&mut self, payout_id: U64, inr_paise: U128, rate_ppu: u32) {
        self.assert_gateway_agent();
        self.assert_rate(rate_ppu);
        let mut p = self.payout_or_panic(payout_id.0);
        require!(p.status == PayoutStatus::Pending, ERR_PAYOUT_STATE);
        let expected = usdc_to_inr(p.usdc.0, rate_ppu, self.limits.spread_bps);
        require!(inr_paise.0 == expected && expected > 0, ERR_AMOUNT_MISMATCH);
        p.inr_paise = Some(inr_paise);
        p.rate_ppu = Some(rate_ppu);
        p.status = PayoutStatus::Processing;
        self.emit_payout(&p);
        self.payouts.insert(payout_id.0, p);
    }

    /// Agent confirms the rupees were paid. The gateway now owns the USDC: it joins the float.
    pub fn complete_payout(&mut self, payout_id: U64, utr_hash: Base58CryptoHash) {
        self.assert_gateway_agent();
        let mut p = self.payout_or_panic(payout_id.0);
        require!(p.status == PayoutStatus::Processing, ERR_PAYOUT_STATE);
        p.status = PayoutStatus::Paid;
        p.utr_hash = Some(utr_hash);
        self.payout_pending -= p.usdc.0;
        self.free_float += p.usdc.0;
        self.pending_payouts.remove(&payout_id.0);
        self.emit_payout(&p);
        self.payouts.insert(payout_id.0, p);
    }

    /// Agent gives up: refund the USDC to the beneficiary; if that transfer fails, it becomes a
    /// claimable refund.
    pub fn fail_payout(&mut self, payout_id: U64, reason: String) -> Promise {
        self.assert_gateway_agent();
        let mut p = self.payout_or_panic(payout_id.0);
        require!(
            p.status == PayoutStatus::Pending || p.status == PayoutStatus::Processing,
            ERR_PAYOUT_STATE
        );
        p.status = PayoutStatus::Failed;
        p.failure_reason = Some(reason.chars().take(MAX_REFERENCE_LEN).collect());
        self.payout_pending -= p.usdc.0;
        self.pending_payouts.remove(&payout_id.0);
        self.emit_payout(&p);
        let (beneficiary, usdc) = (p.beneficiary.clone(), p.usdc);
        self.payouts.insert(payout_id.0, p);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(beneficiary, usdc, Some("runway payout refund".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_refund(payout_id),
            )
    }

    #[private]
    pub fn on_refund(&mut self, payout_id: U64) {
        if promise::succeeded(0) {
            return;
        }
        if let Some(p) = self.payouts.get(&payout_id.0).cloned() {
            self.add_refund(&p.beneficiary, p.usdc.0);
        }
    }

    pub fn claim_refund(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.refunds_claimable.remove(&who).unwrap_or(0);
        require!(amount > 0, ERR_NOTHING_TO_CLAIM);
        self.refunds_total -= amount;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("runway refund".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_refund_claimed(who, U128(amount)),
            )
    }

    #[private]
    pub fn on_refund_claimed(&mut self, account_id: AccountId, amount: U128) {
        if !promise::succeeded(0) {
            self.add_refund(&account_id, amount.0);
        }
    }

    /// Agent stores encrypted payout details for an account (no plaintext on-chain).
    pub fn set_beneficiary_blob(&mut self, account_id: AccountId, ciphertext_b64: String) {
        self.assert_gateway_agent();
        require!(ciphertext_b64.len() <= MAX_BLOB_LEN, ERR_BLOB_TOO_LARGE);
        self.beneficiary_blobs
            .insert(account_id.clone(), ciphertext_b64);
        emit("beneficiary_set", json!({ "account_id": account_id }));
    }
}

impl InrGateway {
    fn payout_or_panic(&self, id: u64) -> PayoutRequest {
        self.payouts
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND))
    }

    fn add_refund(&mut self, who: &AccountId, amount: u128) {
        let prev = self.refunds_claimable.get(who).copied().unwrap_or(0);
        self.refunds_claimable.insert(who.clone(), prev + amount);
        self.refunds_total += amount;
        emit(
            "refund_claimable",
            json!({ "account_id": who, "amount": U128(amount) }),
        );
    }

    fn emit_payout(&self, p: &PayoutRequest) {
        emit(
            "inr_payout",
            json!({
                "payout_id": p.id,
                "kind": p.kind,
                "beneficiary": p.beneficiary,
                "reference": p.reference,
                "usdc": p.usdc,
                "inr_paise": p.inr_paise,
                "rate_ppu": p.rate_ppu,
                "status": p.status,
            }),
        );
    }
}
