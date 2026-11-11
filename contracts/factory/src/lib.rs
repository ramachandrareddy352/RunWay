//! Settlement factory (design §6.1, §7.7).
//!
//! `create_settlement(handle, refund_to)` is callable only by the credit contract. It creates
//! `<handle>.<factory>`, funds it, deploys the **embedded** settlement code, initialises it and adds
//! **no access keys**, so only the settlement code can ever move its funds. Then it registers the new
//! account with the USDC token. Anyone can verify an account is a genuine Runway settlement by checking
//! that it has zero keys and that its code hash equals `get_settlement_code_hash()`.

use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::json;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use runway_shared::errors::*;
use runway_shared::events::emit;
use runway_shared::ext::ext_ft;
use runway_shared::{promise, GAS_CALLBACK, GAS_STORAGE_DEPOSIT, NO_DEPOSIT};

#[cfg(not(feature = "test-hooks"))]
const SETTLEMENT_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../res/runway_settlement.wasm"
));
#[cfg(feature = "test-hooks")]
const SETTLEMENT_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../res/test/runway_settlement.wasm"
));

const GAS_SETTLEMENT_INIT: Gas = Gas::from_tgas(10);
const GAS_ON_ACCOUNT_CREATED: Gas = Gas::from_tgas(40);

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SettlementInit {
    pub bucket_sec: u64,
    pub lock_timeout_blocks: u64,
}

#[near(serializers = [json])]
pub struct FactoryConfig {
    pub credit: AccountId,
    pub token: AccountId,
    pub settlement_init: SettlementInit,
    pub settlement_balance: U128,
    pub token_storage: U128,
    pub required_deposit: U128,
    pub settlement_code_hash: Base58CryptoHash,
    pub settlement_code_size: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    credit: AccountId,
    token: AccountId,
    settlement_init: SettlementInit,
    /// yoctoNEAR transferred to each new settlement account (covers its code + state storage).
    settlement_balance: u128,
    /// yoctoNEAR for the token's `storage_deposit` of the new account.
    token_storage: u128,
}

#[near]
impl Factory {
    #[init]
    pub fn new(
        credit: AccountId,
        token: AccountId,
        settlement_init: SettlementInit,
        settlement_balance: U128,
        token_storage: U128,
    ) -> Self {
        Self {
            credit,
            token,
            settlement_init,
            settlement_balance: settlement_balance.0,
            token_storage: token_storage.0,
        }
    }

    /// Credit contract only. Attach at least `required_deposit()`.
    #[payable]
    pub fn create_settlement(&mut self, handle: String, refund_to: AccountId) -> Promise {
        require!(
            env::predecessor_account_id() == self.credit,
            ERR_ONLY_CREDIT
        );
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.required(), ERR_DEPOSIT_LOW);
        let sub: AccountId = format!("{handle}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str(ERR_BAD_HANDLE));
        let args = json!({
            "credit": self.credit,
            "token": self.token,
            "bucket_sec": self.settlement_init.bucket_sec,
            "lock_timeout_blocks": self.settlement_init.lock_timeout_blocks,
        })
        .to_string()
        .into_bytes();
        // No add_key action: the account is keyless forever.
        Promise::new(sub.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(self.settlement_balance))
            .deploy_contract(SETTLEMENT_WASM.to_vec())
            .function_call("new".to_string(), args, NO_DEPOSIT, GAS_SETTLEMENT_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_ACCOUNT_CREATED)
                    .on_account_created(handle, sub, refund_to, U128(attached)),
            )
    }

    #[private]
    pub fn on_account_created(
        &mut self,
        handle: String,
        sub: AccountId,
        refund_to: AccountId,
        attached: U128,
    ) -> PromiseOrValue<bool> {
        if !promise::succeeded(0) {
            // The failed batch refunded its transfer to this factory; return the whole deposit.
            Promise::new(refund_to.clone())
                .transfer(NearToken::from_yoctonear(attached.0))
                .detach();
            emit(
                "settlement_failed",
                json!({ "handle": handle, "refund_to": refund_to }),
            );
            return PromiseOrValue::Value(false);
        }
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(self.token_storage))
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(sub.clone()), Some(true))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_registered(handle, sub),
            )
            .into()
    }

    #[private]
    pub fn on_registered(&mut self, handle: String, sub: AccountId) -> bool {
        let ok = promise::succeeded(0);
        emit(
            if ok {
                "settlement_created"
            } else {
                "settlement_unregistered"
            },
            json!({ "handle": handle, "settlement": sub }),
        );
        ok
    }

    pub fn required_deposit(&self) -> U128 {
        U128(self.required())
    }

    /// base58(sha256(settlement code)) — the same format NEAR RPC reports as an account's `code_hash`.
    pub fn get_settlement_code_hash(&self) -> Base58CryptoHash {
        Base58CryptoHash::from(Self::code_hash())
    }

    pub fn get_config(&self) -> FactoryConfig {
        FactoryConfig {
            credit: self.credit.clone(),
            token: self.token.clone(),
            settlement_init: self.settlement_init.clone(),
            settlement_balance: U128(self.settlement_balance),
            token_storage: U128(self.token_storage),
            required_deposit: U128(self.required()),
            settlement_code_hash: Base58CryptoHash::from(Self::code_hash()),
            settlement_code_size: SETTLEMENT_WASM.len() as u64,
        }
    }
}

impl Factory {
    fn required(&self) -> u128 {
        self.settlement_balance + self.token_storage
    }

    fn code_hash() -> [u8; 32] {
        env::sha256_array(SETTLEMENT_WASM)
    }
}
