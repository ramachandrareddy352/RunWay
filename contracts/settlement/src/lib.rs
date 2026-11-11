//! Settlement account (design §6.3, §7.2).
//!
//! Deployed by the factory at `<handle>.<factory>` with **zero access keys** and immutable code.
//! Customers' USDC arrives here by plain `ft_transfer` (that is how NEAR Intents 1Click delivers).
//! `settle()` is permissionless: it measures new inflow, splits it per the active loan terms and sends
//! **one** `ft_transfer_call` to the credit contract, which applies the repayment and forwards the
//! merchant's share. The credit contract keeps a monotonic per-settlement `last_op`, so an operation
//! whose callback never ran can be reconciled exactly (`unresolved` + `get_last_op`).
//!
//! The only way tokens leave this account is `settle()`, and only to the credit contract.

use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, near, require, AccountId, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use runway_shared::errors::*;
use runway_shared::ext::{ext_credit, ext_ft};
use runway_shared::*;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Terms {
    pub loan_id: U64,
    pub repay_bps: u16,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct SettleOp {
    pub id: u64,
    pub started_block: u64,
    pub repay: u128,
    pub payout: u128,
    /// The `ft_transfer_call` for this op was scheduled.
    pub sent: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Settlement {
    credit: AccountId,
    token: AccountId,
    bucket_sec: u64,
    lock_timeout_blocks: u64,
    terms: Option<Terms>,
    /// Owed to lenders; retried as repayment until the credit contract accepts it.
    pending_repay: u128,
    /// Owed to the merchant; retried until the credit contract accepts it.
    pending_payout: u128,
    /// The in-flight operation (lock).
    op: Option<SettleOp>,
    /// An op whose transfer was sent but whose outcome is unknown (callback failed or timed out).
    unresolved: Option<SettleOp>,
    next_op_id: u64,
    /// Ring buffer of (bucket index, raw inflow). Public and informational.
    buckets: Vec<(u64, u128)>,
    total_inflow: u128,
    #[cfg(feature = "test-hooks")]
    hook_panic_on_settled: bool,
    #[cfg(feature = "test-hooks")]
    hook_refuse_terms: bool,
}

#[near(serializers = [json])]
pub struct SettlementView {
    pub credit: AccountId,
    pub token: AccountId,
    pub bucket_sec: U64,
    pub lock_timeout_blocks: U64,
    pub terms: Option<Terms>,
    pub pending_repay: U128,
    pub pending_payout: U128,
    pub op: Option<U64>,
    pub unresolved: Option<U64>,
    pub next_op_id: U64,
    pub total_inflow: U128,
    pub current_bucket: U64,
}

#[near(serializers = [json])]
pub struct BucketView {
    pub bucket: U64,
    pub inflow: U128,
}

fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl Settlement {
    #[init]
    pub fn new(
        credit: AccountId,
        token: AccountId,
        bucket_sec: u64,
        lock_timeout_blocks: u64,
    ) -> Self {
        require!(bucket_sec > 0 && lock_timeout_blocks > 0, ERR_BAD_MSG);
        Self {
            credit,
            token,
            bucket_sec,
            lock_timeout_blocks,
            terms: None,
            pending_repay: 0,
            pending_payout: 0,
            op: None,
            unresolved: None,
            next_op_id: 1,
            buckets: Vec::new(),
            total_inflow: 0,
            #[cfg(feature = "test-hooks")]
            hook_panic_on_settled: false,
            #[cfg(feature = "test-hooks")]
            hook_refuse_terms: false,
        }
    }

    /// Permissionless. Splits new inflow and routes it to the credit contract.
    /// If a previous op is unresolved, this call resolves it first; call `settle()` again afterwards.
    pub fn settle(&mut self) -> Promise {
        require!(env::prepaid_gas() >= SETTLE_MIN_GAS, ERR_INSUFFICIENT_GAS);
        if let Some(op) = self.op.clone() {
            require!(
                env::block_height() >= op.started_block + self.lock_timeout_blocks,
                ERR_SETTLE_IN_PROGRESS
            );
            // Lock timed out: the op's callback never ran.
            self.op = None;
            if op.sent && self.unresolved.is_none() {
                self.unresolved = Some(op);
            }
        }
        let id = self.next_op_id;
        self.next_op_id += 1;
        self.op = Some(SettleOp {
            id,
            started_block: env::block_height(),
            repay: 0,
            payout: 0,
            sent: false,
        });
        let me = env::current_account_id();
        if let Some(u) = self.unresolved.clone() {
            return ext_credit::ext(self.credit.clone())
                .with_static_gas(GAS_VIEW)
                .get_last_op(me.clone())
                .then(
                    Self::ext(me)
                        .with_static_gas(GAS_CALLBACK)
                        .on_recovered(U64(id), U64(u.id)),
                );
        }
        ext_ft::ext(self.token.clone())
            .with_static_gas(GAS_FT_BALANCE)
            .ft_balance_of(me.clone())
            .then(
                Self::ext(me)
                    .with_static_gas(GAS_ON_BALANCE)
                    .on_balance(U64(id)),
            )
    }

    #[private]
    pub fn on_balance(
        &mut self,
        op_id: U64,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        if !self.is_current(op_id.0) {
            return PromiseOrValue::Value(());
        }
        let balance = match balance {
            Ok(b) => b.0,
            Err(_) => {
                self.op = None;
                return PromiseOrValue::Value(());
            }
        };
        let accounted = self.pending_repay + self.pending_payout;
        if balance < accounted {
            // Tokens left without being recorded. This cannot happen by construction; refuse to split.
            env::log_str("WARN settlement balance below pending amounts; nothing sent");
            self.op = None;
            return PromiseOrValue::Value(());
        }
        let new_inflow = balance - accounted;
        if new_inflow > 0 {
            self.record_bucket(new_inflow);
        }
        let new_repay = match &self.terms {
            Some(t) => new_inflow * t.repay_bps as u128 / BPS_DENOM,
            None => 0,
        };
        self.pending_repay += new_repay;
        self.pending_payout += new_inflow - new_repay;
        let (repay, payout) = (self.pending_repay, self.pending_payout);
        let total = repay + payout;
        if total == 0 {
            self.op = None;
            return PromiseOrValue::Value(());
        }
        let loan_id = self.terms.as_ref().map(|t| t.loan_id);
        let op = self.op.as_mut().expect("op is current");
        op.repay = repay;
        op.payout = payout;
        op.sent = true;
        let msg = FtMsg::Settle {
            op_id,
            loan_id,
            repay: U128(repay),
            payout: U128(payout),
        };
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER_CALL_SETTLE)
            .ft_transfer_call(self.credit.clone(), U128(total), None, msg.to_json())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_settled(op_id),
            )
            .into()
    }

    #[private]
    pub fn on_settled(&mut self, op_id: U64, #[callback_result] used: Result<U128, PromiseError>) {
        if !self.is_current(op_id.0) {
            return;
        }
        #[cfg(feature = "test-hooks")]
        if self.hook_panic_on_settled {
            env::panic_str("test-hook: on_settled panic");
        }
        let op = self.op.take().expect("op is current");
        let total = op.repay + op.payout;
        match used {
            Ok(u) if u.0 == total => {
                self.pending_repay -= op.repay;
                self.pending_payout -= op.payout;
            }
            // Credit refused the whole transfer (refunded): keep both pendings exactly, retry later.
            Ok(u) if u.0 == 0 => {}
            // Unknown outcome (e.g. resolve failed): reconcile against credit.get_last_op next time.
            _ => self.unresolved = Some(op),
        }
    }

    #[private]
    pub fn on_recovered(
        &mut self,
        lock_id: U64,
        unresolved_id: U64,
        #[callback_result] last: Result<U64, PromiseError>,
    ) {
        if !self.is_current(lock_id.0) {
            return;
        }
        self.op = None;
        let Some(u) = self.unresolved.clone() else {
            return;
        };
        if u.id != unresolved_id.0 {
            return;
        }
        if let Ok(last) = last {
            if last.0 >= u.id {
                // The credit contract processed it: those tokens are gone.
                self.pending_repay = self.pending_repay.saturating_sub(u.repay);
                self.pending_payout = self.pending_payout.saturating_sub(u.payout);
            }
            self.unresolved = None;
        }
        // On Err keep `unresolved`; the next settle() retries the recovery.
    }

    /// Credit contract only. Called when a loan is disbursed.
    pub fn set_terms(&mut self, loan_id: U64, repay_bps: u16) {
        require!(
            env::predecessor_account_id() == self.credit,
            ERR_ONLY_CREDIT
        );
        require!(repay_bps as u128 <= BPS_DENOM, ERR_BOUNDS_REPAY);
        #[cfg(feature = "test-hooks")]
        require!(!self.hook_refuse_terms, "test-hook: refusing set_terms");
        self.terms = Some(Terms { loan_id, repay_bps });
    }

    /// Credit contract only. No-op if the current terms belong to another loan.
    pub fn clear_terms(&mut self, loan_id: U64) {
        require!(
            env::predecessor_account_id() == self.credit,
            ERR_ONLY_CREDIT
        );
        if self.terms.as_ref().map(|t| t.loan_id) == Some(loan_id) {
            self.terms = None;
        }
    }

    pub fn get_state(&self) -> SettlementView {
        SettlementView {
            credit: self.credit.clone(),
            token: self.token.clone(),
            bucket_sec: U64(self.bucket_sec),
            lock_timeout_blocks: U64(self.lock_timeout_blocks),
            terms: self.terms.clone(),
            pending_repay: U128(self.pending_repay),
            pending_payout: U128(self.pending_payout),
            op: self.op.as_ref().map(|o| U64(o.id)),
            unresolved: self.unresolved.as_ref().map(|o| U64(o.id)),
            next_op_id: U64(self.next_op_id),
            total_inflow: U128(self.total_inflow),
            current_bucket: U64(now_sec() / self.bucket_sec),
        }
    }

    /// Buckets in ascending order.
    pub fn get_buckets(&self) -> Vec<BucketView> {
        let mut b = self.buckets.clone();
        b.sort_by_key(|(i, _)| *i);
        b.into_iter()
            .map(|(i, v)| BucketView {
                bucket: U64(i),
                inflow: U128(v),
            })
            .collect()
    }
}

impl Settlement {
    fn is_current(&self, op_id: u64) -> bool {
        self.op.as_ref().map(|o| o.id) == Some(op_id)
    }

    fn record_bucket(&mut self, amount: u128) {
        self.total_inflow += amount;
        let idx = now_sec() / self.bucket_sec;
        if let Some(slot) = self.buckets.iter_mut().find(|(i, _)| *i == idx) {
            slot.1 += amount;
        } else if self.buckets.len() < BUCKET_SLOTS {
            self.buckets.push((idx, amount));
        } else {
            let oldest = self
                .buckets
                .iter()
                .enumerate()
                .min_by_key(|(_, (i, _))| *i)
                .map(|(pos, _)| pos)
                .expect("non-empty");
            self.buckets[oldest] = (idx, amount);
        }
    }
}

#[cfg(feature = "test-hooks")]
#[near]
impl Settlement {
    pub fn hook_set_panic_on_settled(&mut self, value: bool) {
        self.hook_panic_on_settled = value;
    }

    pub fn hook_set_refuse_terms(&mut self, value: bool) {
        self.hook_refuse_terms = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str, ts_sec: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("priya.pay.near"))
            .predecessor_account_id(acc(predecessor))
            .block_timestamp(ts_sec * 1_000_000_000)
            .prepaid_gas(near_sdk::Gas::from_tgas(300))
            .build());
    }

    fn fresh() -> Settlement {
        ctx("pay.near", 1_000);
        Settlement::new(acc("credit.near"), acc("usdc.near"), 60, 100)
    }

    #[test]
    fn split_math_1784_bps() {
        let mut s = fresh();
        ctx("credit.near", 1_000);
        s.set_terms(U64(7), 1_784);
        s.op = Some(SettleOp {
            id: 1,
            started_block: 0,
            repay: 0,
            payout: 0,
            sent: false,
        });
        let _ = s.on_balance(U64(1), Ok(U128(1_000_000_000)));
        assert_eq!(s.pending_repay, 178_400_000);
        assert_eq!(s.pending_payout, 821_600_000);
        assert!(s.op.as_ref().unwrap().sent);
    }

    #[test]
    fn refused_transfer_keeps_pendings_and_unknown_becomes_unresolved() {
        let mut s = fresh();
        s.op = Some(SettleOp {
            id: 1,
            started_block: 0,
            repay: 10,
            payout: 90,
            sent: true,
        });
        s.pending_repay = 10;
        s.pending_payout = 90;
        s.on_settled(U64(1), Ok(U128(0)));
        assert_eq!((s.pending_repay, s.pending_payout), (10, 90));
        assert!(s.unresolved.is_none() && s.op.is_none());

        s.op = Some(SettleOp {
            id: 2,
            started_block: 0,
            repay: 10,
            payout: 90,
            sent: true,
        });
        s.on_settled(U64(2), Err(PromiseError::Failed));
        assert_eq!(s.unresolved.as_ref().unwrap().id, 2);

        // Recovery: credit says op 2 was processed.
        s.op = Some(SettleOp {
            id: 3,
            started_block: 0,
            repay: 0,
            payout: 0,
            sent: false,
        });
        s.on_recovered(U64(3), U64(2), Ok(U64(2)));
        assert_eq!((s.pending_repay, s.pending_payout), (0, 0));
        assert!(s.unresolved.is_none() && s.op.is_none());
    }

    #[test]
    fn accepted_transfer_clears_pendings_and_stale_callbacks_are_ignored() {
        let mut s = fresh();
        s.pending_repay = 10;
        s.pending_payout = 90;
        s.op = Some(SettleOp {
            id: 5,
            started_block: 0,
            repay: 10,
            payout: 90,
            sent: true,
        });
        s.on_settled(U64(4), Ok(U128(100))); // stale id
        assert_eq!(s.pending_payout, 90);
        s.on_settled(U64(5), Ok(U128(100)));
        assert_eq!((s.pending_repay, s.pending_payout), (0, 0));
    }

    #[test]
    fn ring_buffer_wraps_without_growing() {
        let mut s = fresh();
        for i in 0..15u64 {
            ctx("anyone.near", 1_000 + i * 60);
            s.record_bucket(1);
        }
        assert_eq!(s.buckets.len(), BUCKET_SLOTS);
        let b = s.get_buckets();
        assert_eq!(b.first().unwrap().bucket.0, (1_000 + 3 * 60) / 60);
        assert_eq!(s.total_inflow, 15);
    }

    #[test]
    #[should_panic(expected = "ERR_ONLY_CREDIT")]
    fn only_credit_sets_terms() {
        let mut s = fresh();
        ctx("mallory.near", 1_000);
        s.set_terms(U64(1), 500);
    }

    #[test]
    fn clear_terms_ignores_other_loans() {
        let mut s = fresh();
        ctx("credit.near", 1_000);
        s.set_terms(U64(2), 500);
        s.clear_terms(U64(1));
        assert!(s.terms.is_some());
        s.clear_terms(U64(2));
        assert!(s.terms.is_none());
    }
}
