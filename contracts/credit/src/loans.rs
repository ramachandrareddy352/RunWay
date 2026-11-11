//! Loan lifecycle (design §6.5, §6.6, §7.6): callback-gated disbursement, period rolling,
//! provisions, default and capped recoveries.

use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{Gas, Promise, PromiseOrValue};
use runway_shared::events::emit;
use runway_shared::ext::{ext_ft, ext_settlement};
use runway_shared::{
    promise, FtMsg, PayoutKind, PayoutMode, BPS_DENOM, GAS_CALLBACK, GAS_FT_TRANSFER,
    GAS_FT_TRANSFER_CALL_FORWARD, GAS_SET_TERMS, MAX_ROLL_PERIODS, ONE_YOCTO,
};

/// on_terms_set schedules the disbursement transfer and on_disbursed.
const GAS_ON_TERMS_SET: Gas = Gas::from_tgas(75);
const SECONDS_PER_DAY: u64 = 86_400;

#[near]
impl Credit {
    /// Merchant accepts an open offer for `amount` (≤ limit). Attach exactly 1 yoctoNEAR.
    /// Disbursement: set_terms on the settlement → on_terms_set (checks success) → transfer →
    /// on_disbursed (checks success). Any failure releases the reserved liquidity.
    #[payable]
    pub fn accept_offer(&mut self, offer_id: U64, amount: U128) -> Promise {
        assert_one_yocto();
        require!(!self.paused_new_lending, ERR_PAUSED);
        let mut offer = self
            .offers
            .get(&offer_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND));
        require!(offer.status == OfferStatus::Open, ERR_OFFER_NOT_OPEN);
        let now = now_sec();
        require!(now <= offer.expires_at_sec, ERR_OFFER_EXPIRED);
        require!(
            offer.policy_version == self.policy.version,
            ERR_POLICY_VERSION
        );
        let mut m = self.merchant(&offer.handle);
        require!(m.payout == env::predecessor_account_id(), ERR_NOT_MERCHANT);
        require!(!m.frozen, ERR_FROZEN);
        require!(m.active_loan.is_none(), ERR_ACTIVE_LOAN);
        let record = self.record(&offer.handle);
        require!(record.loans_defaulted == 0, ERR_DEFAULTED);

        let amount = amount.0;
        let p = self.policy.clone();
        require!(
            amount >= p.min_loan.0 && amount <= offer.limit.0,
            ERR_BOUNDS_LIMIT
        );
        require!(amount <= p.max_exposure_per_merchant.0, ERR_EXPOSURE);
        require!(amount <= self.free_cash(), ERR_LIQUIDITY);
        require!(
            (self.outstanding_principal + self.reserved + amount) * BPS_DENOM
                <= p.max_utilization_bps as u128 * self.total_assets(),
            ERR_UTILIZATION
        );
        if record.loans_repaid == 0 {
            let day = now / SECONDS_PER_DAY;
            if self.new_merchant_exposure.0 != day {
                self.new_merchant_exposure = (day, 0);
            }
            require!(
                self.new_merchant_exposure.1 + amount <= p.daily_new_merchant_exposure.0,
                ERR_DAILY_CAP
            );
            self.new_merchant_exposure.1 += amount;
        }
        if m.payout_mode == PayoutMode::Inr {
            require!(self.inr_gateway.is_some(), ERR_NO_GATEWAY);
        }

        let repay_bps = (mul_div_ceil(offer.repay_bps as u128, amount, offer.limit.0) as u16)
            .max(p.repay_bps_min);
        let fee = amount * offer.fee_bps as u128 / BPS_DENOM;
        let id = self.next_id();
        let loan = Loan {
            id: U64(id),
            handle: offer.handle.clone(),
            offer_id,
            principal: U128(amount),
            fee_bps: offer.fee_bps,
            fee: U128(fee),
            owed: U128(amount + fee),
            repaid: U128(0),
            principal_repaid: U128(0),
            repay_bps,
            payout_mode: m.payout_mode,
            status: LoanStatus::PendingTerms,
            disbursed_sec: 0,
            period_end_sec: 0,
            repaid_in_period: U128(0),
            missed: 0,
            provisioned: U128(0),
            written_off: U128(0),
            reserve_drawn: U128(0),
            recovered_lenders: U128(0),
            recovered_reserve: U128(0),
        };
        self.reserved += amount;
        offer.status = OfferStatus::Accepted;
        self.offers.insert(offer_id.0, offer);
        m.active_loan = Some(U64(id));
        m.open_offer = None;
        let settlement = m.settlement.clone();
        self.merchants.insert(loan.handle.clone(), m);
        self.emit_loan(&loan, "PendingTerms");
        self.loans.insert(id, loan);

        ext_settlement::ext(settlement)
            .with_static_gas(GAS_SET_TERMS)
            .set_terms(U64(id), repay_bps)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_TERMS_SET)
                    .on_terms_set(U64(id)),
            )
    }

    #[private]
    pub fn on_terms_set(&mut self, loan_id: U64) -> PromiseOrValue<()> {
        let Some(mut loan) = self.loans.get(&loan_id.0).cloned() else {
            return PromiseOrValue::Value(());
        };
        if loan.status != LoanStatus::PendingTerms {
            return PromiseOrValue::Value(());
        }
        if !promise::succeeded(0) {
            self.fail_loan(&mut loan, false);
            self.loans.insert(loan_id.0, loan);
            return PromiseOrValue::Value(());
        }
        loan.status = LoanStatus::PendingTransfer;
        let payout = self.merchant(&loan.handle).payout;
        let amount = loan.principal;
        let transfer = match loan.payout_mode {
            PayoutMode::Usdc => ext_ft::ext(self.token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(payout, amount, Some(format!("runway loan {}", loan_id.0))),
            PayoutMode::Inr => {
                let gateway = self
                    .inr_gateway
                    .clone()
                    .unwrap_or_else(|| env::panic_str(ERR_NO_GATEWAY));
                let msg = FtMsg::InrPayout {
                    kind: PayoutKind::LoanDisbursement,
                    beneficiary: payout,
                    reference: loan_id.0.to_string(),
                };
                ext_ft::ext(self.token.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER_CALL_FORWARD)
                    .ft_transfer_call(gateway, amount, None, msg.to_json())
            }
        };
        self.loans.insert(loan_id.0, loan);
        transfer
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_disbursed(loan_id),
            )
            .into()
    }

    #[private]
    pub fn on_disbursed(&mut self, loan_id: U64) {
        let Some(mut loan) = self.loans.get(&loan_id.0).cloned() else {
            return;
        };
        if loan.status != LoanStatus::PendingTransfer {
            return;
        }
        let principal = loan.principal.0;
        let delivered = match loan.payout_mode {
            PayoutMode::Usdc => {
                if promise::succeeded(0) {
                    principal
                } else {
                    0
                }
            }
            PayoutMode::Inr => promise::result_u128(0).unwrap_or(0).min(principal),
        };
        if delivered == 0 {
            self.fail_loan(&mut loan, true);
        } else {
            // The gateway never returns a partial amount, but if it did the unused part came back:
            // the loan is re-sized to what actually left the vault.
            self.reserved -= principal;
            if delivered < principal {
                env::log_str("WARN partial disbursement; loan resized");
                loan.principal = U128(delivered);
                loan.fee = U128(delivered * loan.fee_bps as u128 / BPS_DENOM);
                loan.owed = U128(delivered + loan.fee.0);
            }
            self.cash -= delivered;
            self.outstanding_principal += delivered;
            let now = now_sec();
            loan.status = LoanStatus::Active;
            loan.disbursed_sec = now;
            loan.period_end_sec = now + self.time.period_sec;
            let mut record = self.record(&loan.handle);
            record.total_borrowed = U128(record.total_borrowed.0 + delivered);
            self.records.insert(loan.handle.clone(), record);
            self.active_loans.insert(loan_id.0);
            self.emit_loan(&loan, "Active");
        }
        self.loans.insert(loan_id.0, loan);
    }

    /// Permissionless: advances periods (delinquency, provisions, default).
    pub fn check_loan(&mut self, loan_id: U64) -> LoanStatus {
        let mut loan = self
            .loans
            .get(&loan_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND));
        self.roll(&mut loan, now_sec());
        let status = loan.status;
        self.loans.insert(loan_id.0, loan);
        status
    }
}

impl Credit {
    fn fail_loan(&mut self, loan: &mut Loan, clear_terms: bool) {
        loan.status = LoanStatus::Failed;
        self.reserved -= loan.principal.0;
        let mut m = self.merchant(&loan.handle);
        if m.active_loan == Some(loan.id) {
            m.active_loan = None;
        }
        let settlement = m.settlement.clone();
        self.merchants.insert(loan.handle.clone(), m);
        if clear_terms {
            ext_settlement::ext(settlement)
                .with_static_gas(GAS_SET_TERMS)
                .clear_terms(loan.id)
                .detach();
        }
        self.emit_loan(loan, "Failed");
    }

    /// Closes every finished period. A period is missed if less than `min_period_repay_bps` of
    /// the total owed (or the remainder, if smaller) was repaid in it.
    pub(crate) fn roll(&mut self, loan: &mut Loan, now: u64) {
        if !matches!(loan.status, LoanStatus::Active | LoanStatus::Delinquent) {
            return;
        }
        let mut closed = 0;
        while now >= loan.period_end_sec && closed < MAX_ROLL_PERIODS {
            let remaining_at_start = loan.owed.0 - (loan.repaid.0 - loan.repaid_in_period.0);
            let required = (loan.owed.0 * self.policy.min_period_repay_bps as u128 / BPS_DENOM)
                .min(remaining_at_start);
            if loan.repaid_in_period.0 < required {
                loan.missed += 1;
            } else {
                loan.missed = 0;
            }
            loan.repaid_in_period = U128(0);
            loan.period_end_sec += self.time.period_sec;
            closed += 1;
            if loan.missed >= self.policy.default_after_missed {
                self.default_loan(loan);
                return;
            }
        }
        if loan.missed > 0 {
            if loan.status == LoanStatus::Active {
                loan.status = LoanStatus::Delinquent;
                self.emit_loan(loan, "Delinquent");
            }
            self.refresh_provision(loan);
        } else if loan.status == LoanStatus::Delinquent {
            loan.status = LoanStatus::Active;
            self.release_provision(loan);
            self.emit_loan(loan, "Active");
        }
    }

    fn refresh_provision(&mut self, loan: &mut Loan) {
        let target = (loan.principal.0 - loan.principal_repaid.0)
            * self.policy.delinquency_provision_bps as u128
            / BPS_DENOM;
        self.provisions = self.provisions - loan.provisioned.0 + target;
        loan.provisioned = U128(target);
    }

    fn release_provision(&mut self, loan: &mut Loan) {
        self.provisions -= loan.provisioned.0;
        loan.provisioned = U128(0);
    }

    fn default_loan(&mut self, loan: &mut Loan) {
        self.release_provision(loan);
        let w = loan.principal.0 - loan.principal_repaid.0;
        self.outstanding_principal -= w;
        let d = self.reserve.min(w);
        self.reserve -= d;
        self.cash += d;
        loan.written_off = U128(w);
        loan.reserve_drawn = U128(d);
        loan.status = LoanStatus::Defaulted;
        let mut record = self.record(&loan.handle);
        record.loans_defaulted += 1;
        self.records.insert(loan.handle.clone(), record);
        let mut m = self.merchant(&loan.handle);
        m.active_loan = None;
        self.merchants.insert(loan.handle.clone(), m);
        self.active_loans.remove(&loan.id.0);
        emit(
            "loan_defaulted",
            json!({ "loan_id": loan.id, "handle": loan.handle, "written_off": U128(w), "reserve_drawn": U128(d) }),
        );
    }

    /// Applies up to `x` to the loan and returns the amount applied (the caller handles the rest).
    /// `only_handle`: when set (settlement path) the loan must belong to that merchant.
    pub(crate) fn apply_repayment(
        &mut self,
        loan_id: u64,
        only_handle: Option<&str>,
        x: u128,
    ) -> u128 {
        let Some(mut loan) = self.loans.get(&loan_id).cloned() else {
            return 0;
        };
        if let Some(h) = only_handle {
            if loan.handle != h {
                return 0;
            }
        }
        self.roll(&mut loan, now_sec());
        let applied = match loan.status {
            LoanStatus::Active | LoanStatus::Delinquent => self.apply_regular(&mut loan, x),
            LoanStatus::Defaulted => self.apply_recovery(&mut loan, x),
            _ => 0,
        };
        self.loans.insert(loan_id, loan);
        applied
    }

    /// Cumulative principal accounting: no rounding drift across many small repayments.
    fn apply_regular(&mut self, loan: &mut Loan, x: u128) -> u128 {
        let a = x.min(loan.owed.0 - loan.repaid.0);
        if a == 0 {
            return 0;
        }
        let new_repaid = loan.repaid.0 + a;
        let new_principal_repaid = if new_repaid == loan.owed.0 {
            loan.principal.0
        } else {
            new_repaid * loan.principal.0 / loan.owed.0
        };
        let p = new_principal_repaid - loan.principal_repaid.0;
        let f = a - p;
        let cut = f * self.policy.protocol_fee_share_bps as u128 / BPS_DENOM;
        self.outstanding_principal -= p;
        self.cash += a - cut;
        self.reserve += cut;
        loan.repaid = U128(new_repaid);
        loan.principal_repaid = U128(new_principal_repaid);
        loan.repaid_in_period = U128(loan.repaid_in_period.0 + a);
        let mut record = self.record(&loan.handle);
        record.total_repaid = U128(record.total_repaid.0 + a);
        emit(
            "loan_repayment",
            json!({ "loan_id": loan.id, "amount": U128(a), "principal_part": U128(p), "fee_part": U128(f) }),
        );
        if new_repaid == loan.owed.0 {
            loan.status = LoanStatus::Repaid;
            self.release_provision(loan);
            record.loans_repaid += 1;
            let mut m = self.merchant(&loan.handle);
            if m.active_loan == Some(loan.id) {
                m.active_loan = None;
            }
            let settlement = m.settlement.clone();
            self.merchants.insert(loan.handle.clone(), m);
            self.active_loans.remove(&loan.id.0);
            ext_settlement::ext(settlement)
                .with_static_gas(GAS_SET_TERMS)
                .clear_terms(loan.id)
                .detach();
            self.emit_loan(loan, "Repaid");
        } else if loan.status == LoanStatus::Delinquent {
            self.refresh_provision(loan);
        }
        self.records.insert(loan.handle.clone(), record);
        a
    }

    /// Recoveries after default: lenders first, then the reserve, then fee income. Capped at what
    /// is still owed.
    fn apply_recovery(&mut self, loan: &mut Loan, x: u128) -> u128 {
        let a = x.min(loan.owed.0 - loan.repaid.0);
        if a == 0 {
            return 0;
        }
        let lenders_due = loan.written_off.0 - loan.reserve_drawn.0 - loan.recovered_lenders.0;
        let to_lenders = a.min(lenders_due);
        let reserve_due = loan.reserve_drawn.0 - loan.recovered_reserve.0;
        let to_reserve = (a - to_lenders).min(reserve_due);
        let rest = a - to_lenders - to_reserve;
        let cut = rest * self.policy.protocol_fee_share_bps as u128 / BPS_DENOM;
        self.cash += to_lenders + rest - cut;
        self.reserve += to_reserve + cut;
        loan.recovered_lenders = U128(loan.recovered_lenders.0 + to_lenders);
        loan.recovered_reserve = U128(loan.recovered_reserve.0 + to_reserve);
        loan.repaid = U128(loan.repaid.0 + a);
        let mut record = self.record(&loan.handle);
        record.total_repaid = U128(record.total_repaid.0 + a);
        self.records.insert(loan.handle.clone(), record);
        emit(
            "loan_recovery",
            json!({ "loan_id": loan.id, "amount": U128(a), "to_lenders": U128(to_lenders), "to_reserve": U128(to_reserve) }),
        );
        if loan.repaid.0 == loan.owed.0 {
            let settlement = self.merchant(&loan.handle).settlement;
            ext_settlement::ext(settlement)
                .with_static_gas(GAS_SET_TERMS)
                .clear_terms(loan.id)
                .detach();
        }
        a
    }

    pub(crate) fn emit_loan(&self, loan: &Loan, to: &str) {
        emit(
            "loan_state",
            json!({
                "loan_id": loan.id, "handle": loan.handle, "to": to,
                "principal": loan.principal, "owed": loan.owed, "repaid": loan.repaid,
                "repay_bps": loan.repay_bps,
            }),
        );
    }
}
