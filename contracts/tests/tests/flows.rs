//! Sandbox integration tests. IDs match BUILD_PLAN sec. 7.1 / design sec. 15.1.
//! Run: bash scripts/build-contracts.sh && cargo test -p runway-integration-tests -- --test-threads=4

// `ok(...)?` returns the ExecutionFinalResult for callers that need it; many tests only need the check.
#![allow(unused_must_use)]

use anyhow::Result;
use near_workspaces::types::NearToken;
use runway_integration_tests::*;
use serde_json::json;

const M: u128 = USDC;

/// T1 + F2: register -> payment without a loan -> offer -> accept -> split -> repaid, with exact vault math.
#[tokio::test]
async fn t1_happy_path_and_f2_keyless_settlement() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    env.seed_reserve(100).await?;
    assert_eq!(env.shares_of(env.lender.id()).await?, 10_000 * M);

    let s = env.register_merchant(&env.priya, "priya").await?;
    // F2: zero access keys, and the factory publishes the same code hash the build script computed.
    assert!(env.worker.view_access_keys(&s).await?.is_empty());
    let factory_hash: String = env
        .view(env.factory.id(), "get_settlement_code_hash", json!({}))
        .await?;
    let hashes = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../res/CODE_HASHES.txt"
    ))?;
    assert!(
        hashes
            .lines()
            .any(|l| l == format!("{factory_hash}  runway_settlement.wasm")),
        "factory hash {factory_hash} not in CODE_HASHES.txt"
    );
    env.assert_invariants(std::slice::from_ref(&s)).await?;

    // No loan: 100% to the merchant.
    env.deliver(&s, 1_000 * M).await?;
    let r = ok(env.settle(&s).await?)?;
    assert_eq!(events(&r, "settled").len(), 1);
    assert_eq!(env.balance(env.priya.id()).await?, 1_000 * M);

    // Anchored first offer (cap 500), accept: state machine PendingTerms -> PendingTransfer -> Active.
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    ok(env.accept(&env.priya, offer, 500).await?)?;
    let m = env.merchant("priya").await?;
    let loan_id = u(&m["merchant"]["active_loan"]) as u64;
    let loan = env.loan(loan_id).await?;
    assert_eq!(loan["status"], "Active");
    assert_eq!(u(&loan["owed"]), 535 * M);
    assert_eq!(env.balance(env.priya.id()).await?, 1_500 * M);
    assert_eq!(env.settlement_state(&s).await?["terms"]["repay_bps"], 1784);
    env.assert_invariants(std::slice::from_ref(&s)).await?;

    // A routed $1,000 payment: 178.40 to the vault, 821.60 to Priya.
    env.deliver(&s, 1_000 * M).await?;
    let r = ok(env.settle(&s).await?)?;
    let ev = &events(&r, "settled")[0];
    assert_eq!(u(&ev["repay_applied"]), 178_400_000);
    assert_eq!(u(&ev["payout"]), 821_600_000);
    assert_eq!(env.balance(env.priya.id()).await?, 1_500 * M + 821_600_000);

    // $2,000 more: only the remaining 356.60 is applied; the 0.20 excess goes to Priya.
    env.deliver(&s, 2_000 * M).await?;
    let r = ok(env.settle(&s).await?)?;
    let ev = &events(&r, "settled")[0];
    assert_eq!(u(&ev["repay_applied"]), 356_600_000);
    assert_eq!(u(&ev["excess_to_merchant"]), 200_000);
    let loan = env.loan(loan_id).await?;
    assert_eq!(loan["status"], "Repaid");
    assert_eq!(u(&loan["principal_repaid"]), 500 * M);
    let rec = env.merchant("priya").await?["record"].clone();
    assert_eq!(rec["loans_repaid"], 1);
    assert!(
        env.settlement_state(&s).await?["terms"].is_null(),
        "terms cleared after repayment"
    );

    // Exact vault math: 9,500 + 535 - protocol cut (10% of fee parts, floored per repayment).
    let v = env.vault().await?;
    assert_eq!(u(&v["outstanding_principal"]), 0);
    assert_eq!(u(&v["cash"]), 10_031_500_001);
    assert_eq!(u(&v["reserve"]), 103_499_999);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// S1/S3: the credit contract refuses the settle transfer -> both pendings are kept and the repay
/// part is later applied as repayment, never paid to the merchant.
#[tokio::test]
async fn s1_refused_repay_leg_is_retried_as_repayment() -> Result<()> {
    let env = Env::new(Options {
        hooks: true,
        ..Default::default()
    })
    .await?;
    env.deposit(&env.lender, 10_000).await?;
    let (s, loan_id) = env.merchant_with_loan(&env.priya, "priya", 500).await?;
    let before = env.balance(env.priya.id()).await?;

    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "hook_set_refuse_settle",
            json!({ "value": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    env.deliver(&s, 1_000 * M).await?;
    let _ = env.settle(&s).await?;
    let st = env.settlement_state(&s).await?;
    assert_eq!(u(&st["pending_repay"]), 178_400_000);
    assert_eq!(u(&st["pending_payout"]), 821_600_000);
    assert!(st["op"].is_null() && st["unresolved"].is_null());
    assert_eq!(
        env.balance(env.priya.id()).await?,
        before,
        "merchant got nothing while refused"
    );
    assert_eq!(u(&env.loan(loan_id).await?["repaid"]), 0);

    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "hook_set_refuse_settle",
            json!({ "value": false }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    ok(env.settle(&s).await?)?;
    assert_eq!(
        u(&env.loan(loan_id).await?["repaid"]),
        178_400_000,
        "retried as repayment"
    );
    assert_eq!(env.balance(env.priya.id()).await?, before + 821_600_000);
    let st = env.settlement_state(&s).await?;
    assert_eq!(u(&st["pending_repay"]) + u(&st["pending_payout"]), 0);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// S2 + P2: the merchant payout transfer fails (payout account not registered with USDC) -> the
/// amount becomes claimable; after registering, claim_payout delivers it.
#[tokio::test]
async fn s2_failed_payout_becomes_claimable() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    let root = env.worker.root_account()?;
    let ravi = root
        .create_subaccount("ravi")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let s = env.register_merchant(&ravi, "ravi").await?;
    env.deliver(&s, 300 * M).await?;
    ok(env.settle(&s).await?)?;
    let m = env.merchant("ravi").await?;
    assert_eq!(u(&m["claimable"]), 300 * M);
    env.assert_invariants(std::slice::from_ref(&s)).await?;

    env.register_usdc(&ravi, ravi.id()).await?;
    ok(env
        .call(
            &ravi,
            env.credit.id(),
            "claim_payout",
            json!({}),
            NO_DEPOSIT,
            100,
        )
        .await?)?;
    assert_eq!(env.balance(ravi.id()).await?, 300 * M);
    assert_eq!(u(&env.merchant("ravi").await?["claimable"]), 0);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// S4: on_settled panics after the credit contract processed the op -> the lock blocks further
/// settles until it times out; recovery reads credit.get_last_op and clears the pendings exactly once.
#[tokio::test]
async fn s4_stuck_lock_recovers_exactly_once() -> Result<()> {
    let env = Env::new(Options {
        hooks: true,
        ..Default::default()
    })
    .await?;
    let s = env.register_merchant(&env.priya, "priya").await?;
    ok(env
        .call(
            &env.owner,
            &s,
            "hook_set_panic_on_settled",
            json!({ "value": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    env.deliver(&s, 100 * M).await?;
    let _ = env.settle(&s).await?; // credit processes op 1, then on_settled panics
    assert_eq!(env.balance(env.priya.id()).await?, 100 * M);
    let last: serde_json::Value = env
        .view(env.credit.id(), "get_last_op", json!({ "settlement": s }))
        .await?;
    assert_eq!(u(&last), 1);
    let st = env.settlement_state(&s).await?;
    assert!(!st["op"].is_null(), "lock still held");

    expect_err(env.settle(&s).await?, "ERR_SETTLE_IN_PROGRESS")?;
    ok(env
        .call(
            &env.owner,
            &s,
            "hook_set_panic_on_settled",
            json!({ "value": false }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    env.advance_blocks(env.opts.lock_timeout_blocks + 2).await?;
    ok(env.settle(&s).await?)?; // recovery
    let st = env.settlement_state(&s).await?;
    assert!(st["op"].is_null() && st["unresolved"].is_null());
    assert_eq!(u(&st["pending_payout"]), 0);
    ok(env.settle(&s).await?)?; // nothing new to send
    assert_eq!(
        env.balance(env.priya.id()).await?,
        100 * M,
        "no double payout"
    );
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// S8: settle needs enough prepaid gas for every callback in its chain.
#[tokio::test]
async fn s8_settle_requires_min_gas() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    let s = env.register_merchant(&env.priya, "priya").await?;
    let r = env
        .call(&env.keeper, &s, "settle", json!({}), NO_DEPOSIT, 100)
        .await?;
    expect_err(r, "ERR_INSUFFICIENT_GAS")
}

/// C1: set_terms fails -> loan Failed, liquidity released, nothing transferred.
#[tokio::test]
async fn c1_set_terms_failure_releases_liquidity_without_transfer() -> Result<()> {
    let env = Env::new(Options {
        hooks: true,
        ..Default::default()
    })
    .await?;
    env.deposit(&env.lender, 10_000).await?;
    let s = env.register_merchant(&env.priya, "priya").await?;
    ok(env
        .call(
            &env.owner,
            &s,
            "hook_set_refuse_terms",
            json!({ "value": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    let _ = env.accept(&env.priya, offer, 500).await?;
    assert_eq!(env.balance(env.priya.id()).await?, 0, "no disbursement");
    let v = env.vault().await?;
    assert_eq!(u(&v["cash"]), 10_000 * M);
    assert_eq!(u(&v["reserved"]), 0);
    let m = env.merchant("priya").await?;
    assert!(m["merchant"]["active_loan"].is_null());
    let loan = env.loan(offer + 1).await?;
    assert_eq!(loan["status"], "Failed");
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// C2: the disbursement transfer fails (payout not registered) -> loan Failed and terms cleared.
#[tokio::test]
async fn c2_disbursement_failure_clears_terms() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    let root = env.worker.root_account()?;
    let ravi = root
        .create_subaccount("ravi")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let s = env.register_merchant(&ravi, "ravi").await?;
    let offer = env.offer("ravi", 500, 700, 1784, Some(2)).await?;
    let _ = env.accept(&ravi, offer, 500).await?;
    let loan = env.loan(offer + 1).await?;
    assert_eq!(loan["status"], "Failed");
    assert!(
        env.settlement_state(&s).await?["terms"].is_null(),
        "clear_terms reached the settlement"
    );
    let v = env.vault().await?;
    assert_eq!(u(&v["cash"]), 10_000 * M);
    assert_eq!(u(&v["reserved"]), 0);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// C9 + F1: only the merchant's payout account can accept; handles and accounts are unique.
#[tokio::test]
async fn c9_f1_authorization_and_uniqueness() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    env.register_merchant(&env.priya, "priya").await?;
    let offer = env.offer("priya", 100, 700, 1784, None).await?;
    expect_err(
        env.accept(&env.lender, offer, 100).await?,
        "ERR_NOT_MERCHANT",
    )?;

    let dep: serde_json::Value = env
        .view(env.factory.id(), "required_deposit", json!({}))
        .await?;
    let deposit = NearToken::from_yoctonear(u(&dep));
    let r = env
        .call(
            &env.lender,
            env.credit.id(),
            "register_merchant",
            json!({ "handle": "priya" }),
            deposit,
            300,
        )
        .await?;
    expect_err(r, "ERR_HANDLE_TAKEN")?;
    let r = env
        .call(
            &env.priya,
            env.credit.id(),
            "register_merchant",
            json!({ "handle": "priya2" }),
            deposit,
            300,
        )
        .await?;
    expect_err(r, "ERR_ALREADY_REGISTERED")?;
    let r = env
        .call(
            &env.lender,
            env.credit.id(),
            "register_merchant",
            json!({ "handle": "Bad.Handle" }),
            deposit,
            300,
        )
        .await?;
    expect_err(r, "ERR_BAD_HANDLE")
}

/// C13: payout_mode = Inr forwards the merchant share to the INR gateway; a refusal becomes claimable.
#[tokio::test]
async fn c13_inr_mode_settle_forwards_to_gateway() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    let s = env.register_merchant(&env.priya, "priya").await?;
    expect_err(
        env.call(
            &env.priya,
            env.credit.id(),
            "set_payout_mode",
            json!({ "mode": "Inr" }),
            ONE_YOCTO,
            30,
        )
        .await?,
        "ERR_NO_GATEWAY",
    )?;
    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "set_inr_gateway",
            json!({ "account_id": env.gateway.id() }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    ok(env
        .call(
            &env.priya,
            env.credit.id(),
            "set_payout_mode",
            json!({ "mode": "Inr" }),
            ONE_YOCTO,
            30,
        )
        .await?)?;

    env.deliver(&s, 1_000 * M).await?;
    ok(env.settle(&s).await?)?;
    let got: Vec<serde_json::Value> = env
        .view(env.gateway.id(), "get_received", json!({}))
        .await?;
    assert_eq!(got.len(), 1);
    assert_eq!(u(&got[0]["amount"]), 1_000 * M);
    let msg: serde_json::Value = serde_json::from_str(got[0]["msg"].as_str().unwrap())?;
    assert_eq!(msg["kind"], "merchant_share");
    assert_eq!(msg["beneficiary"], env.priya.id().to_string());

    ok(env
        .call(
            &env.owner,
            env.gateway.id(),
            "set_mode",
            json!({ "accept": false }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    env.deliver(&s, 200 * M).await?;
    ok(env.settle(&s).await?)?;
    assert_eq!(u(&env.merchant("priya").await?["claimable"]), 200 * M);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// C14: in Inr mode the loan is disbursed through the gateway; a refusal fails the loan cleanly.
#[tokio::test]
async fn c14_inr_mode_disbursement() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "set_inr_gateway",
            json!({ "account_id": env.gateway.id() }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let s = env.register_merchant(&env.priya, "priya").await?;
    ok(env
        .call(
            &env.priya,
            env.credit.id(),
            "set_payout_mode",
            json!({ "mode": "Inr" }),
            ONE_YOCTO,
            30,
        )
        .await?)?;

    ok(env
        .call(
            &env.owner,
            env.gateway.id(),
            "set_mode",
            json!({ "accept": false }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    let _ = env.accept(&env.priya, offer, 500).await?;
    assert_eq!(env.loan(offer + 1).await?["status"], "Failed");
    assert_eq!(u(&env.vault().await?["cash"]), 10_000 * M);

    ok(env
        .call(
            &env.owner,
            env.gateway.id(),
            "set_mode",
            json!({ "accept": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    ok(env.accept(&env.priya, offer, 500).await?)?;
    assert_eq!(env.loan(offer + 1).await?["status"], "Active");
    let got: Vec<serde_json::Value> = env
        .view(env.gateway.id(), "get_received", json!({}))
        .await?;
    let msg: serde_json::Value =
        serde_json::from_str(got.last().unwrap()["msg"].as_str().unwrap())?;
    assert_eq!(msg["kind"], "loan_disbursement");
    assert_eq!(env.balance(env.gateway.id()).await?, 500 * M);
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// V2 + V9 + V10: a missed period marks the loan Delinquent and books a provision immediately; a
/// withdrawal claimed afterwards is priced after the provision. Cooldown and liquidity are enforced.
///
/// Timing margins are wide on purpose (a slow sandbox spends 10-20 s of chain time per transaction):
/// the requests are made before the loan exists, so a cooldown much longer than any transaction
/// latency can be fast-forwarded without the loan running. Escrowed shares are priced at claim, so
/// the claim still sees the provision. The loan is checked 130 s into a 120 s period, leaving
/// ~110 s before a second missed period (which would default it).
#[tokio::test]
async fn v2_v9_v10_provision_cooldown_liquidity() -> Result<()> {
    let env = Env::new(Options {
        period_sec: 120,
        cooldown_sec: 120,
        ..Default::default()
    })
    .await?;
    env.deposit(&env.lender, 10_000).await?;

    let small = env
        .call(
            &env.lender,
            env.credit.id(),
            "request_withdraw",
            json!({ "shares": (1_000 * M).to_string() }),
            ONE_YOCTO,
            50,
        )
        .await?;
    let small_id = u(&ok(small)?.json::<serde_json::Value>()?) as u64;
    let big = env
        .call(
            &env.lender,
            env.credit.id(),
            "request_withdraw",
            json!({ "shares": (9_000 * M).to_string() }),
            ONE_YOCTO,
            50,
        )
        .await?;
    let big_id = u(&ok(big)?.json::<serde_json::Value>()?) as u64;
    // V9: before the cooldown.
    expect_err(
        env.call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": small_id.to_string() }),
            NO_DEPOSIT,
            100,
        )
        .await?,
        "ERR_COOLDOWN",
    )?;
    env.advance_secs(125).await?; // past the cooldown; no loan exists yet

    let (s, loan_id) = env.merchant_with_loan(&env.priya, "priya", 500).await?;
    env.advance_secs(130).await?; // one period passes with nothing repaid
    ok(env
        .call(
            &env.keeper,
            env.credit.id(),
            "check_loan",
            json!({ "loan_id": loan_id.to_string() }),
            NO_DEPOSIT,
            50,
        )
        .await?)?;
    assert_eq!(env.loan(loan_id).await?["status"], "Delinquent");
    let v = env.vault().await?;
    assert_eq!(u(&v["provisions"]), 250 * M);

    // Priced after the provision: 1,000 shares of (9,500 + 500 - 250) / 10,000.
    let before = env.balance(env.lender.id()).await?;
    ok(env
        .call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": small_id.to_string() }),
            NO_DEPOSIT,
            100,
        )
        .await?)?;
    let got = env.balance(env.lender.id()).await? - before;
    assert!(got > 974 * M && got < 976 * M, "got {got}");
    // V10: the big request exceeds free cash; it stays open.
    expect_err(
        env.call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": big_id.to_string() }),
            NO_DEPOSIT,
            100,
        )
        .await?,
        "ERR_LIQUIDITY",
    )?;
    let r: serde_json::Value = env
        .view(
            env.credit.id(),
            "get_withdraw_request",
            json!({ "request_id": big_id.to_string() }),
        )
        .await?;
    assert_eq!(r["status"], "Open");
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// V8: pausing blocks new lending only; settle, check_loan and withdrawals keep working.
#[tokio::test]
async fn v8_pause_blocks_lending_only() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    let (s, loan_id) = env.merchant_with_loan(&env.priya, "priya", 500).await?;
    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "pause_new_lending",
            json!({ "paused": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;

    let expires = env.now_sec().await? + 300;
    let r = env
        .call(
            &env.agent,
            env.credit.id(),
            "submit_offer",
            json!({
        "handle": "priya", "limit": usdc(100), "fee_bps": 700, "repay_bps": 1784, "grade": "B",
        "anchor_hash": null, "inputs_commitment": b58_hash(9), "llm_receipt_hash": null,
        "expires_at_sec": expires.to_string(), "policy_version": 1 }),
            NO_DEPOSIT,
            50,
        )
        .await?;
    expect_err(r, "ERR_PAUSED")?;

    env.deliver(&s, 1_000 * M).await?;
    ok(env.settle(&s).await?)?;
    assert_eq!(u(&env.loan(loan_id).await?["repaid"]), 178_400_000);
    ok(env
        .call(
            &env.keeper,
            env.credit.id(),
            "check_loan",
            json!({ "loan_id": loan_id.to_string() }),
            NO_DEPOSIT,
            50,
        )
        .await?)?;
    let req = ok(env
        .call(
            &env.lender,
            env.credit.id(),
            "request_withdraw",
            json!({ "shares": (100 * M).to_string() }),
            ONE_YOCTO,
            50,
        )
        .await?)?;
    let id = u(&req.json::<serde_json::Value>()?) as u64;
    env.advance_secs(env.opts.cooldown_sec + 1).await?;
    ok(env
        .call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": id.to_string() }),
            NO_DEPOSIT,
            100,
        )
        .await?)?;
    env.assert_invariants(&[s]).await?;
    Ok(())
}

/// V14: an INR withdrawal goes through the gateway; a refusal restores the escrowed shares.
#[tokio::test]
async fn v14_inr_withdrawal() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    ok(env
        .call(
            &env.owner,
            env.credit.id(),
            "set_inr_gateway",
            json!({ "account_id": env.gateway.id() }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    ok(env
        .call(
            &env.owner,
            env.gateway.id(),
            "set_mode",
            json!({ "accept": false }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let req = ok(env
        .call(
            &env.lender,
            env.credit.id(),
            "request_withdraw",
            json!({ "shares": (1_000 * M).to_string(), "payout": "Inr" }),
            ONE_YOCTO,
            50,
        )
        .await?)?;
    let id = u(&req.json::<serde_json::Value>()?) as u64;
    env.advance_secs(env.opts.cooldown_sec + 1).await?;
    let _ = env
        .call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": id.to_string() }),
            NO_DEPOSIT,
            150,
        )
        .await?;
    let r: serde_json::Value = env
        .view(
            env.credit.id(),
            "get_withdraw_request",
            json!({ "request_id": id.to_string() }),
        )
        .await?;
    assert_eq!(r["status"], "Open");
    assert_eq!(u(&r["shares"]), 1_000 * M, "shares restored to escrow");
    assert_eq!(u(&env.vault().await?["cash"]), 10_000 * M);

    ok(env
        .call(
            &env.owner,
            env.gateway.id(),
            "set_mode",
            json!({ "accept": true }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    ok(env
        .call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": id.to_string() }),
            NO_DEPOSIT,
            150,
        )
        .await?)?;
    let got: Vec<serde_json::Value> = env
        .view(env.gateway.id(), "get_received", json!({}))
        .await?;
    let msg: serde_json::Value = serde_json::from_str(got[0]["msg"].as_str().unwrap())?;
    assert_eq!(msg["kind"], "lender_withdrawal");
    assert_eq!(u(&got[0]["amount"]), 1_000 * M);
    env.assert_invariants(&[]).await?;
    Ok(())
}

/// P1: changing the payout account requires a USDC-registered account; records stay consistent.
#[tokio::test]
async fn p1_update_payout() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.register_merchant(&env.priya, "priya").await?;
    let root = env.worker.root_account()?;
    let fresh = root
        .create_subaccount("priya2")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;

    let r = env
        .call(
            &env.priya,
            env.credit.id(),
            "update_payout",
            json!({ "new_payout": fresh.id() }),
            ONE_YOCTO,
            100,
        )
        .await?;
    expect_err(r, "ERR_NOT_REGISTERED_STORAGE")?;
    assert_eq!(
        env.merchant("priya").await?["merchant"]["payout"],
        env.priya.id().to_string()
    );

    env.register_usdc(&env.owner, fresh.id()).await?;
    ok(env
        .call(
            &env.priya,
            env.credit.id(),
            "update_payout",
            json!({ "new_payout": fresh.id() }),
            ONE_YOCTO,
            100,
        )
        .await?)?;
    assert_eq!(
        env.merchant("priya").await?["merchant"]["payout"],
        fresh.id().to_string()
    );
    let by_new: serde_json::Value = env
        .view(
            env.credit.id(),
            "get_merchant_by_account",
            json!({ "account_id": fresh.id() }),
        )
        .await?;
    assert_eq!(by_new["merchant"]["handle"], "priya");
    let by_old: serde_json::Value = env
        .view(
            env.credit.id(),
            "get_merchant_by_account",
            json!({ "account_id": env.priya.id() }),
        )
        .await?;
    assert!(by_old.is_null());
    Ok(())
}

/// C6: in TEE mode a non-implicit account cannot register as an agent.
#[tokio::test]
async fn c6_tee_mode_requires_implicit_account() -> Result<()> {
    let env = Env::new(Options {
        requires_tee: true,
        ..Default::default()
    })
    .await?;
    let c = env.credit.id();
    ok(env
        .call(
            &env.owner,
            c,
            "approve_measurements",
            json!({ "measurements": mock_measurements() }),
            NO_DEPOSIT,
            30,
        )
        .await?)?;
    let r = env
        .call(
            &env.agent,
            c,
            "register_agent",
            json!({ "attestation": mock_attestation() }),
            NearToken::from_millinear(10),
            100,
        )
        .await?;
    expect_err(r, "Account ID must be implicit account")?;
    let r = env
        .call(
            &env.owner,
            c,
            "whitelist_agent_for_local",
            json!({ "account_id": env.agent.id() }),
            NO_DEPOSIT,
            30,
        )
        .await?;
    expect_err(r, "not supported for TEE")
}

/// Keeps the TypeScript fixtures (mock attestation, measurements, PPID) in sync with the Rust types.
/// Regenerate with: UPDATE_FIXTURES=1 cargo test -p runway-integration-tests fixtures
#[test]
fn fixtures_are_current() -> Result<()> {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/config/fixtures"
    );
    let files = [
        ("mock-attestation.json", mock_attestation()),
        ("mock-measurements.json", mock_measurements()),
        ("default-ppid.json", default_ppid()),
        ("policy-sandbox.json", policy()),
    ];
    for (name, value) in files {
        let path = format!("{dir}/{name}");
        let text = serde_json::to_string_pretty(&value)? + "\n";
        if std::env::var("UPDATE_FIXTURES").is_ok() {
            std::fs::create_dir_all(dir)?;
            std::fs::write(&path, &text)?;
        } else {
            let current = std::fs::read_to_string(&path)
                .map_err(|e| anyhow::anyhow!("{path}: {e}. Run with UPDATE_FIXTURES=1"))?;
            assert_eq!(current, text, "{name} is stale; run with UPDATE_FIXTURES=1");
        }
    }
    Ok(())
}
