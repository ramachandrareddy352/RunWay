//! Sandbox harness for the Runway contracts (BUILD_PLAN T1.6).
//!
//! `Env::new(opts)` starts a local NEAR sandbox and deploys mock USDC, the factory, the credit
//! contract (local agent mode) and the stub INR gateway, creates the actors, funds them and
//! registers a local Underwriter agent. Wasm comes from `res/` (built by
//! `scripts/build-contracts.sh`); `opts.hooks` selects the `res/test/` builds with failure hooks.

// `ok(...)?` hands back the ExecutionFinalResult for callers that need it; most only need the check.
#![allow(unused_must_use)]

use anyhow::{anyhow, bail, Result};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use runway_shared::agents::{
    create_mock_dstack_attestation, create_mock_full_measurements_hex, Ppid,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);
/// yoctoNEAR given to each new settlement account (covers ~145 KB code + state).
pub const SETTLEMENT_BALANCE: u128 = 2_000_000_000_000_000_000_000_000;
/// yoctoNEAR for the token's storage_deposit of a new settlement account.
pub const TOKEN_STORAGE: u128 = 1_250_000_000_000_000_000_000;

pub fn usdc(whole: u128) -> String {
    (whole * USDC).to_string()
}

#[derive(Clone, Debug)]
pub struct Options {
    /// Use the `test-hooks` builds of settlement, factory and credit.
    pub hooks: bool,
    pub bucket_sec: u64,
    pub period_sec: u64,
    pub cooldown_sec: u64,
    /// Well above one settle's receipt chain plus a few transactions (~10 blocks on a slow
    /// sandbox), so a held lock is still held when a test checks it; tests that need the timeout
    /// fast-forward past it, which is cheap.
    pub lock_timeout_blocks: u64,
    pub requires_tee: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            hooks: false,
            bucket_sec: 60,
            period_sec: 3_600,
            cooldown_sec: 5,
            lock_timeout_blocks: 60,
            requires_tee: false,
        }
    }
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub owner: Account,
    pub lender: Account,
    pub priya: Account,
    pub solver: Account,
    pub agent: Account,
    pub keeper: Account,
    pub usdc: Contract,
    pub factory: Contract,
    pub credit: Contract,
    pub gateway: Contract,
    pub opts: Options,
}

fn wasm(name: &str, hooks: bool) -> Result<Vec<u8>> {
    let base = concat!(env!("CARGO_MANIFEST_DIR"), "/../../res");
    let hooked = ["runway_settlement", "runway_factory", "runway_credit"].contains(&name);
    let path = if hooks && hooked {
        format!("{base}/test/{name}.wasm")
    } else {
        format!("{base}/{name}.wasm")
    };
    std::fs::read(&path).map_err(|e| anyhow!("{path}: {e}. Run: bash scripts/build-contracts.sh"))
}

pub fn policy() -> Value {
    let caps = |v: [u128; 4]| v.iter().map(|x| usdc(*x)).collect::<Vec<_>>();
    json!({
        "version": 1,
        "anchored_caps": caps([500, 2_000, 5_000, 15_000]),
        "unanchored_caps": caps([100, 250, 500, 1_000]),
        "min_loan": usdc(50),
        "fee_bps_min": 300, "fee_bps_max": 1500,
        "repay_bps_min": 500, "repay_bps_max": 2500,
        "max_utilization_bps": 8000,
        "max_exposure_per_merchant": usdc(15_000),
        "daily_new_merchant_exposure": usdc(2_000),
        "min_period_repay_bps": 1000,
        "default_after_missed": 2,
        "delinquency_provision_bps": 5000,
        "protocol_fee_share_bps": 1000,
        "merchant_registration_deposit": (SETTLEMENT_BALANCE + TOKEN_STORAGE).to_string(),
    })
}

pub fn mock_measurements() -> Value {
    serde_json::to_value(create_mock_full_measurements_hex()).expect("serialize")
}

pub fn mock_attestation() -> Value {
    serde_json::to_value(create_mock_dstack_attestation()).expect("serialize")
}

pub fn default_ppid() -> Value {
    serde_json::to_value(Ppid::default()).expect("serialize")
}

/// A 32-byte hash (all bytes = `byte`, non-zero) as base58, for anchors and commitments.
pub fn b58_hash(byte: u8) -> String {
    assert!(byte != 0, "use a non-zero byte");
    const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits = vec![0u8];
    for _ in 0..32 {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    digits
        .iter()
        .rev()
        .map(|d| A[*d as usize] as char)
        .collect()
}

async fn sub(root: &Account, name: &str, near: u128) -> Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

/// Fails with the full failure list unless the transaction and all its receipts succeeded.
pub fn ok(r: ExecutionFinalResult) -> Result<ExecutionFinalResult> {
    if r.is_failure() {
        bail!("transaction failed: {:#?}", r.failures());
    }
    Ok(r)
}

/// Asserts the transaction failed with a message containing `needle`.
pub fn expect_err(r: ExecutionFinalResult, needle: &str) -> Result<()> {
    let text = format!("{:?}", r.failures());
    if r.is_success() || !text.contains(needle) {
        bail!(
            "expected failure containing {needle:?}, got success={} {text}",
            r.is_success()
        );
    }
    Ok(())
}

/// All `EVENT_JSON` payloads with the given event name.
pub fn events(r: &ExecutionFinalResult, name: &str) -> Vec<Value> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|v| v["event"] == name)
        .map(|v| v["data"][0].clone())
        .collect()
}

pub fn u(v: &Value) -> u128 {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| v.as_u64().map(|x| x as u128))
        .unwrap_or_else(|| panic!("not a number: {v}"))
}

impl Env {
    pub async fn new(opts: Options) -> Result<Self> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let owner = sub(&root, "owner", 100).await?;
        let lender = sub(&root, "lender", 50).await?;
        let priya = sub(&root, "priya", 50).await?;
        let solver = sub(&root, "solver", 50).await?;
        let agent = sub(&root, "agent", 20).await?;
        let keeper = sub(&root, "keeper", 50).await?;

        let usdc_acc = sub(&root, "usdc", 20).await?;
        let factory_acc = sub(&root, "pay", 30).await?;
        let credit_acc = sub(&root, "credit", 50).await?;
        let gateway_acc = sub(&root, "gateway", 10).await?;
        let usdc = usdc_acc
            .deploy(&wasm("runway_mock_usdc", false)?)
            .await?
            .into_result()?;
        let factory = factory_acc
            .deploy(&wasm("runway_factory", opts.hooks)?)
            .await?
            .into_result()?;
        let credit = credit_acc
            .deploy(&wasm("runway_credit", opts.hooks)?)
            .await?
            .into_result()?;
        let gateway = gateway_acc
            .deploy(&wasm("runway_stub_gateway", false)?)
            .await?
            .into_result()?;

        ok(usdc
            .call("new")
            .args_json(json!({ "owner": owner.id() }))
            .transact()
            .await?)?;
        ok(factory
            .call("new")
            .args_json(json!({
                "credit": credit.id(),
                "token": usdc.id(),
                "settlement_init": { "bucket_sec": opts.bucket_sec, "lock_timeout_blocks": opts.lock_timeout_blocks },
                "settlement_balance": SETTLEMENT_BALANCE.to_string(),
                "token_storage": TOKEN_STORAGE.to_string(),
            }))
            .transact()
            .await?)?;
        ok(credit
            .call("new")
            .args_json(json!({
                "owner": owner.id(), "guardian": owner.id(), "token": usdc.id(), "factory": factory.id(),
                "policy": policy(),
                "time": { "period_sec": opts.period_sec, "withdraw_cooldown_sec": opts.cooldown_sec,
                          "offer_ttl_sec": 600, "policy_timelock_sec": 0 },
                "requires_tee": opts.requires_tee,
                "attestation_expiration_time_ms": "86400000",
            }))
            .transact()
            .await?)?;
        ok(gateway.call("new").transact().await?)?;

        let requires_tee = opts.requires_tee;
        let env = Self {
            worker,
            owner,
            lender,
            priya,
            solver,
            agent,
            keeper,
            usdc,
            factory,
            credit,
            gateway,
            opts,
        };
        for id in [
            env.credit.id().clone(),
            env.gateway.id().clone(),
            env.owner.id().clone(),
            env.lender.id().clone(),
            env.priya.id().clone(),
            env.solver.id().clone(),
        ] {
            env.register_usdc(&env.owner, &id).await?;
        }
        env.mint(env.lender.id(), 20_000).await?;
        env.mint(env.solver.id(), 1_000_000).await?;
        env.mint(env.owner.id(), 1_000).await?;
        env.register_shares(&env.lender).await?;

        if !requires_tee {
            env.setup_local_agent().await?;
        }
        Ok(env)
    }

    // ---------- low-level ----------

    pub async fn call(
        &self,
        who: &Account,
        contract: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
        tgas: u64,
    ) -> Result<ExecutionFinalResult> {
        Ok(who
            .call(contract, method)
            .args_json(args)
            .deposit(deposit)
            .gas(Gas::from_tgas(tgas))
            .transact()
            .await?)
    }

    pub async fn view<T: DeserializeOwned>(
        &self,
        contract: &AccountId,
        method: &str,
        args: Value,
    ) -> Result<T> {
        Ok(self
            .worker
            .view(contract, method)
            .args_json(args)
            .await?
            .json()?)
    }

    pub async fn now_sec(&self) -> Result<u64> {
        Ok(self.worker.view_block().await?.timestamp() / 1_000_000_000)
    }

    /// Advances chain time by at least `secs` seconds.
    pub async fn advance_secs(&self, secs: u64) -> Result<()> {
        let target = self.now_sec().await? + secs;
        while self.now_sec().await? < target {
            self.worker.fast_forward(20).await?;
        }
        Ok(())
    }

    pub async fn advance_blocks(&self, blocks: u64) -> Result<()> {
        self.worker.fast_forward(blocks).await?;
        Ok(())
    }

    // ---------- token ----------

    pub async fn register_usdc(&self, payer: &Account, id: &AccountId) -> Result<()> {
        ok(self
            .call(
                payer,
                self.usdc.id(),
                "storage_deposit",
                json!({ "account_id": id, "registration_only": true }),
                NearToken::from_millinear(10),
                30,
            )
            .await?)?;
        Ok(())
    }

    pub async fn mint(&self, to: &AccountId, whole: u128) -> Result<()> {
        ok(self
            .call(
                &self.owner,
                self.usdc.id(),
                "mint",
                json!({ "account_id": to, "amount": usdc(whole) }),
                NO_DEPOSIT,
                30,
            )
            .await?)?;
        Ok(())
    }

    pub async fn balance(&self, id: &AccountId) -> Result<u128> {
        let v: Value = self
            .view(self.usdc.id(), "ft_balance_of", json!({ "account_id": id }))
            .await?;
        Ok(u(&v))
    }

    /// 1Click-style delivery: a plain `ft_transfer` from the solver to the settlement account.
    pub async fn deliver(&self, settlement: &AccountId, micro: u128) -> Result<()> {
        ok(self
            .call(
                &self.solver,
                self.usdc.id(),
                "ft_transfer",
                json!({ "receiver_id": settlement, "amount": micro.to_string() }),
                ONE_YOCTO,
                30,
            )
            .await?)?;
        Ok(())
    }

    // ---------- vault ----------

    pub async fn register_shares(&self, who: &Account) -> Result<()> {
        ok(self
            .call(
                who,
                self.credit.id(),
                "storage_deposit",
                json!({ "account_id": who.id(), "registration_only": true }),
                NearToken::from_millinear(10),
                30,
            )
            .await?)?;
        Ok(())
    }

    pub async fn deposit(&self, who: &Account, whole: u128) -> Result<ExecutionFinalResult> {
        ok(self
            .call(who, self.usdc.id(), "ft_transfer_call",
                  json!({ "receiver_id": self.credit.id(), "amount": usdc(whole), "msg": r#"{"action":"deposit"}"# }),
                  ONE_YOCTO, 150)
            .await?)
    }

    pub async fn seed_reserve(&self, whole: u128) -> Result<()> {
        ok(self
            .call(&self.owner, self.usdc.id(), "ft_transfer_call",
                  json!({ "receiver_id": self.credit.id(), "amount": usdc(whole), "msg": r#"{"action":"seed_reserve"}"# }),
                  ONE_YOCTO, 150)
            .await?)?;
        Ok(())
    }

    pub async fn vault(&self) -> Result<Value> {
        self.view(self.credit.id(), "get_vault", json!({})).await
    }

    pub async fn shares_of(&self, id: &AccountId) -> Result<u128> {
        let v: Value = self
            .view(
                self.credit.id(),
                "ft_balance_of",
                json!({ "account_id": id }),
            )
            .await?;
        Ok(u(&v))
    }

    // ---------- agents ----------

    pub async fn setup_local_agent(&self) -> Result<()> {
        let c = self.credit.id();
        ok(self
            .call(
                &self.owner,
                c,
                "approve_measurements",
                json!({ "measurements": mock_measurements() }),
                NO_DEPOSIT,
                30,
            )
            .await?)?;
        ok(self
            .call(
                &self.owner,
                c,
                "approve_ppids",
                json!({ "ppids": [default_ppid()] }),
                NO_DEPOSIT,
                30,
            )
            .await?)?;
        ok(self
            .call(
                &self.owner,
                c,
                "set_role",
                json!({ "measurements": mock_measurements(), "role": "Underwriter" }),
                NO_DEPOSIT,
                30,
            )
            .await?)?;
        ok(self
            .call(
                &self.owner,
                c,
                "whitelist_agent_for_local",
                json!({ "account_id": self.agent.id() }),
                NO_DEPOSIT,
                30,
            )
            .await?)?;
        ok(self
            .call(
                &self.agent,
                c,
                "register_agent",
                json!({ "attestation": mock_attestation() }),
                NearToken::from_millinear(10),
                100,
            )
            .await?)?;
        Ok(())
    }

    // ---------- merchants ----------

    pub async fn register_merchant(&self, who: &Account, handle: &str) -> Result<AccountId> {
        let dep: Value = self
            .view(self.factory.id(), "required_deposit", json!({}))
            .await?;
        let r = ok(self
            .call(
                who,
                self.credit.id(),
                "register_merchant",
                json!({ "handle": handle }),
                NearToken::from_yoctonear(u(&dep)),
                300,
            )
            .await?)?;
        let logs = format!("{:#?}", r.logs());
        if r.json::<bool>().ok() != Some(true) {
            bail!("register_merchant returned false: {logs}");
        }
        Ok(format!("{handle}.{}", self.factory.id()).parse()?)
    }

    pub async fn merchant(&self, handle: &str) -> Result<Value> {
        self.view(
            self.credit.id(),
            "get_merchant",
            json!({ "handle": handle }),
        )
        .await
    }

    pub async fn settle(&self, settlement: &AccountId) -> Result<ExecutionFinalResult> {
        self.call(
            &self.keeper,
            settlement,
            "settle",
            json!({}),
            NO_DEPOSIT,
            250,
        )
        .await
    }

    pub async fn settlement_state(&self, settlement: &AccountId) -> Result<Value> {
        self.view(settlement, "get_state", json!({})).await
    }

    /// Submits an offer from the local agent; returns the offer id.
    pub async fn offer(
        &self,
        handle: &str,
        limit_whole: u128,
        fee_bps: u16,
        repay_bps: u16,
        anchor: Option<u8>,
    ) -> Result<u64> {
        let expires = self.now_sec().await? + 300;
        let r = ok(self
            .call(&self.agent, self.credit.id(), "submit_offer",
                  json!({
                      "handle": handle, "limit": usdc(limit_whole), "fee_bps": fee_bps, "repay_bps": repay_bps,
                      "grade": "B", "anchor_hash": anchor.map(b58_hash), "inputs_commitment": b58_hash(9),
                      "llm_receipt_hash": null, "expires_at_sec": expires.to_string(), "policy_version": 1,
                  }),
                  NO_DEPOSIT, 50)
            .await?)?;
        let id: Value = r.json()?;
        Ok(u(&id) as u64)
    }

    pub async fn accept(
        &self,
        who: &Account,
        offer_id: u64,
        whole: u128,
    ) -> Result<ExecutionFinalResult> {
        self.call(
            who,
            self.credit.id(),
            "accept_offer",
            json!({ "offer_id": offer_id.to_string(), "amount": usdc(whole) }),
            ONE_YOCTO,
            300,
        )
        .await
    }

    pub async fn loan(&self, id: u64) -> Result<Value> {
        self.view(
            self.credit.id(),
            "get_loan",
            json!({ "loan_id": id.to_string() }),
        )
        .await
    }

    /// Registers `who` as `handle`, gets an anchored offer and accepts it. Returns (settlement, loan id).
    pub async fn merchant_with_loan(
        &self,
        who: &Account,
        handle: &str,
        whole: u128,
    ) -> Result<(AccountId, u64)> {
        let settlement = self.register_merchant(who, handle).await?;
        let offer = self.offer(handle, whole, 700, 1784, Some(1)).await?;
        ok(self.accept(who, offer, whole).await?)?;
        let m = self.merchant(handle).await?;
        let loan = u(&m["merchant"]["active_loan"]) as u64;
        Ok((settlement, loan))
    }

    // ---------- invariants (design sec. 15.2) ----------

    pub async fn assert_invariants(&self, settlements: &[AccountId]) -> Result<()> {
        let v = self.vault().await?;
        let cash = u(&v["cash"]);
        let reserve = u(&v["reserve"]);
        let claimable = u(&v["merchant_claimable_total"]);
        let in_transit = u(&v["in_transit"]);
        let bal = self.balance(self.credit.id()).await?;
        // I1
        if bal < cash + reserve + claimable + in_transit {
            bail!("I1 violated: balance {bal} < cash {cash} + reserve {reserve} + claimable {claimable} + in_transit {in_transit}");
        }
        // I2, I3, I4 over active loans; I2b: nothing reserved at rest.
        let loans: Vec<Value> = self
            .view(self.credit.id(), "get_active_loans", json!({}))
            .await?;
        let mut outstanding = 0;
        let mut provisions = 0;
        for l in &loans {
            let (p, pr, r, o) = (
                u(&l["principal"]),
                u(&l["principal_repaid"]),
                u(&l["repaid"]),
                u(&l["owed"]),
            );
            if pr > p || r > o {
                bail!("I3 violated on loan {l}");
            }
            outstanding += p - pr;
            provisions += u(&l["provisioned"]);
        }
        if outstanding != u(&v["outstanding_principal"]) {
            bail!(
                "I2 violated: sum {outstanding} != outstanding {}",
                v["outstanding_principal"]
            );
        }
        if provisions != u(&v["provisions"]) {
            bail!(
                "I4 violated: sum {provisions} != provisions {}",
                v["provisions"]
            );
        }
        if u(&v["reserved"]) != 0 {
            bail!("I2b violated: reserved {} at rest", v["reserved"]);
        }
        // I6, I7 per settlement
        let expected_code = wasm("runway_settlement", self.opts.hooks)?;
        for s in settlements {
            let st = self.settlement_state(s).await?;
            if st["op"].is_null() {
                let pend = u(&st["pending_repay"]) + u(&st["pending_payout"]);
                let sb = self.balance(s).await?;
                if pend > sb {
                    bail!("I6 violated for {s}: pendings {pend} > balance {sb}");
                }
            }
            let keys = self.worker.view_access_keys(s).await?;
            if !keys.is_empty() {
                bail!("I7 violated: {s} has {} access keys", keys.len());
            }
            let code = self.worker.view_code(s).await?;
            if code != expected_code {
                bail!("I7 violated: {s} code differs from the settlement wasm the factory embeds");
            }
        }
        Ok(())
    }
}
