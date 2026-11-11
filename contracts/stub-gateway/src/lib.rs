//! Test-only stand-in for `inr.runway` (BUILD_PLAN T1.6). Records the last `InrPayout` and either keeps
//! the tokens (`accept`) or panics so the token contract refunds them (`refuse`).

use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, PanicOnDefault, PromiseOrValue};
use runway_shared::FtMsg;

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Received {
    pub sender_id: AccountId,
    pub amount: U128,
    pub msg: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct StubGateway {
    accept: bool,
    received: Vec<(AccountId, U128, String)>,
}

#[near]
impl StubGateway {
    #[init]
    pub fn new() -> Self {
        Self {
            accept: true,
            received: Vec::new(),
        }
    }

    pub fn set_mode(&mut self, accept: bool) {
        self.accept = accept;
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if !self.accept {
            env::panic_str("stub-gateway: refusing");
        }
        if !matches!(FtMsg::parse(&msg), Some(FtMsg::InrPayout { .. })) {
            env::panic_str("stub-gateway: expected inr_payout");
        }
        self.received.push((sender_id, amount, msg));
        PromiseOrValue::Value(U128(0))
    }

    pub fn get_received(&self) -> Vec<Received> {
        self.received
            .iter()
            .map(|(s, a, m)| Received {
                sender_id: s.clone(),
                amount: *a,
                msg: m.clone(),
            })
            .collect()
    }
}
