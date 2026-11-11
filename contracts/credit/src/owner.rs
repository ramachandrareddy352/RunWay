//! Owner and guardian operations. Nothing here can block exits: settle, repay, claim_payout,
//! claim_withdraw and check_loan are never pausable.

use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::Promise;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::{promise, GAS_CALLBACK, GAS_FT_BALANCE};

#[near]
impl Credit {
    /// Guardian or owner. Blocks `submit_offer` and `accept_offer` only.
    pub fn pause_new_lending(&mut self, paused: bool) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.guardian || caller == self.owner,
            ERR_NOT_GUARDIAN
        );
        self.paused_new_lending = paused;
        emit("paused", json!({ "paused": paused }));
    }

    /// Owner. `policy.version` must be `current + 1`. Applies immediately when the timelock is 0,
    /// otherwise call `apply_policy` after `policy_timelock_sec`.
    pub fn propose_policy(&mut self, policy: Policy) {
        self.assert_owner();
        policy.validate();
        require!(
            policy.version == self.policy.version + 1,
            ERR_POLICY_VERSION
        );
        if self.time.policy_timelock_sec == 0 {
            self.policy = policy;
            emit("policy_updated", json!({ "version": self.policy.version }));
        } else {
            let ready = now_sec() + self.time.policy_timelock_sec;
            emit(
                "policy_proposed",
                json!({ "version": policy.version, "ready_at_sec": ready }),
            );
            self.pending_policy = Some((policy, ready));
        }
    }

    pub fn apply_policy(&mut self) {
        self.assert_owner();
        let (policy, ready) = self
            .pending_policy
            .take()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_FOUND));
        require!(now_sec() >= ready, ERR_POLICY_TIMELOCK);
        self.policy = policy;
        emit("policy_updated", json!({ "version": self.policy.version }));
    }

    pub fn set_inr_gateway(&mut self, account_id: Option<AccountId>) {
        self.assert_owner();
        self.inr_gateway = account_id.clone();
        emit("inr_gateway_set", json!({ "account_id": account_id }));
    }

    pub fn set_guardian(&mut self, guardian: AccountId) {
        self.assert_owner();
        self.guardian = guardian;
    }

    pub fn set_exit_app_cid(&mut self, cid: String) {
        self.assert_owner();
        self.exit_app_cid = Some(cid);
    }

    /// Moves stray USDC (sent without a message) into the reserve. Requires no transfers in flight.
    pub fn sweep_surplus(&mut self) -> Promise {
        self.assert_owner();
        require!(
            self.reserved == 0 && self.in_transit == 0,
            ERR_REQUEST_STATE
        );
        ext_ft::ext(self.token.clone())
            .with_static_gas(GAS_FT_BALANCE)
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_surplus_balance(),
            )
    }

    #[private]
    pub fn on_surplus_balance(&mut self) -> U128 {
        let Some(balance) = promise::result_u128(0) else {
            return U128(0);
        };
        let accounted = self.cash + self.reserve + self.claimable_total + self.in_transit;
        let surplus = balance.saturating_sub(accounted);
        if surplus > 0 && self.reserved == 0 && self.in_transit == 0 {
            self.reserve += surplus;
            emit("surplus_swept", json!({ "amount": U128(surplus) }));
            return U128(surplus);
        }
        U128(0)
    }
}

#[cfg(feature = "test-hooks")]
#[near]
impl Credit {
    /// Test only: make every settle message panic (the token refunds the transfer).
    pub fn hook_set_refuse_settle(&mut self, value: bool) {
        self.hook_refuse_settle = value;
    }
}
