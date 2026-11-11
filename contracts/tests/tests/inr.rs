//! Sandbox tests for the real INR gateway (BUILD_PLAN T4b.2): G1–G13 and I8, plus C13, C14, V13
//! and V14 re-run against `inr-gateway` instead of `stub-gateway`.
//! Run: bash scripts/build-contracts.sh && cargo test -p runway-integration-tests --test inr

#![allow(unused_must_use)]

use anyhow::Result;
use near_workspaces::types::NearToken;
use runway_integration_tests::*;
use serde_json::{json, Value};

const M: u128 = USDC;
/// ₹85.00 per USDC, in paise.
const RATE: u32 = 8_500;

fn sale(handle: &str) -> Value {
    json!({ "type": "merchant_sale", "handle": handle })
}

/// Sends `whole` USDC from `who` to the gateway with an `inr_payout` message.
async fn send_payout(
    env: &Env,
    inr: &Inr,
    who: &near_workspaces::Account,
    whole: u128,
    kind: &str,
    beneficiary: &str,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    let msg = json!({ "action": "inr_payout", "kind": kind, "beneficiary": beneficiary, "reference": "self" });
    env.call(
        who,
        env.usdc.id(),
        "ft_transfer_call",
        json!({ "receiver_id": inr.contract.id(), "amount": usdc(whole), "msg": msg.to_string() }),
        ONE_YOCTO,
        150,
    )
    .await
}

async fn agent_call(
    env: &Env,
    inr: &Inr,
    method: &str,
    args: Value,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    env.call(&inr.agent, inr.contract.id(), method, args, NO_DEPOSIT, 100)
        .await
}

/// G1–G7 and G12: pay-in checks in contract order, failed delivery, and the pause switch.
#[tokio::test]
async fn g1_to_g7_g12_payins() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    let inr = env.deploy_inr_gateway().await?;
    let s = env.register_merchant(&env.priya, "priya").await?;

    // G6: only a registered agent with role InrGateway may record pay-ins. The credit
    // contract's Underwriter agent is not an agent of the gateway.
    let args = json!({
        "payment_ref_hash": b58_hash(10), "kind": sale("priya"), "inr_paise": "850000",
        "rate_ppu": RATE, "payer_ref_hash": null,
    });
    for who in [&env.lender, &env.agent] {
        expect_err(
            env.call(
                who,
                inr.contract.id(),
                "record_payin",
                args.clone(),
                NO_DEPOSIT,
                150,
            )
            .await?,
            "ERR_AGENT_INVALID",
        )?;
    }

    // G1: ₹8,500 at ₹85 = 100 USDC to the settlement account; the receipt is listed by handle.
    let r = ok(env
        .record_payin(&inr, 10, sale("priya"), 850_000, RATE)
        .await?)?;
    assert_eq!(events(&r, "inr_payin")[0]["status"], "Delivered");
    assert_eq!(env.balance(&s).await?, 100 * M);
    let rec = env.receipt(&inr, 10).await?;
    assert_eq!(rec["status"], "Delivered");
    assert_eq!(u(&rec["usdc"]), 100 * M);
    assert_eq!(u(&rec["delivered"]), 100 * M);
    assert_eq!(u(&env.float(&inr).await?["free"]), 900 * M);
    let listed: Vec<Value> = env
        .view(
            inr.contract.id(),
            "get_payins_by_handle",
            json!({ "handle": "priya" }),
        )
        .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0][0], b58_hash(10));
    env.assert_inr_invariant(&inr).await?;

    // G2: the same payment reference again.
    expect_err(
        env.record_payin(&inr, 10, sale("priya"), 850_000, RATE)
            .await?,
        "ERR_PAYIN_REPLAY",
    )?;
    // G3: rate outside ₹70–₹130.
    for rate in [6_999, 13_001] {
        expect_err(
            env.record_payin(&inr, 11, sale("priya"), 850_000, rate)
                .await?,
            "ERR_RATE_BAND",
        )?;
    }
    // G4: above the ₹1,00,000 per-payment cap.
    expect_err(
        env.record_payin(&inr, 12, sale("priya"), 10_000_001, RATE)
            .await?,
        "ERR_PAYIN_CAP",
    )?;
    // G5: ₹1,00,000 at ₹70 = 1,428.57 USDC, more than the 900 USDC float.
    expect_err(
        env.record_payin(&inr, 13, sale("priya"), 10_000_000, 7_000)
            .await?,
        "ERR_FLOAT",
    )?;

    // G7: a sale for an unregistered handle: delivery fails, the receipt is Failed and the float
    // is restored.
    let _ = env
        .record_payin(&inr, 14, sale("nobody"), 850_000, RATE)
        .await?;
    let rec = env.receipt(&inr, 14).await?;
    assert_eq!(rec["status"], "Failed");
    assert_eq!(u(&rec["delivered"]), 0);
    assert_eq!(u(&env.float(&inr).await?["free"]), 900 * M);
    env.assert_inr_invariant(&inr).await?;

    // G12: paused pay-ins are refused until unpaused.
    let pause = |p: bool| {
        env.call(
            &env.owner,
            inr.contract.id(),
            "pause_payins",
            json!({ "paused": p }),
            NO_DEPOSIT,
            30,
        )
    };
    ok(pause(true).await?)?;
    expect_err(
        env.record_payin(&inr, 15, sale("priya"), 850_000, RATE)
            .await?,
        "ERR_PAYINS_PAUSED",
    )?;
    ok(pause(false).await?)?;
    ok(env
        .record_payin(&inr, 15, sale("priya"), 850_000, RATE)
        .await?)?;

    // The two sales settle like any other inflow: no loan, so 100% to Priya.
    let before = env.balance(env.priya.id()).await?;
    ok(env.settle(&s).await?)?;
    assert_eq!(env.balance(env.priya.id()).await? - before, 200 * M);
    env.assert_invariants(&[s]).await?;
    env.assert_inr_invariant(&inr).await?;
    Ok(())
}

/// G8 + V13 (lender deposits paid in rupees), G9 (who may request a payout), G10 (Paid) and
/// G11 (failed payouts: refunded, or claimable when the refund transfer fails).
#[tokio::test]
async fn g8_to_g11_v13_deposits_and_payouts() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    let inr = env.deploy_inr_gateway().await?;

    // G8/V13: a rupee deposit mints shares to the beneficiary at the current share price
    // (1:1 here, since assets equal supply).
    let shares_before = env.shares_of(env.lender.id()).await?;
    let deposit_for = |who: &str| json!({ "type": "lender_deposit", "beneficiary": who });
    ok(env
        .record_payin(
            &inr,
            20,
            deposit_for(env.lender.id().as_str()),
            850_000,
            RATE,
        )
        .await?)?;
    assert_eq!(
        env.shares_of(env.lender.id()).await? - shares_before,
        100 * M
    );
    assert_eq!(env.receipt(&inr, 20).await?["status"], "Delivered");
    // An account without share storage: credit refunds everything, the receipt is Failed and the
    // float is restored.
    let _ = env
        .record_payin(
            &inr,
            21,
            deposit_for(env.priya.id().as_str()),
            850_000,
            RATE,
        )
        .await?;
    let rec = env.receipt(&inr, 21).await?;
    assert_eq!(rec["status"], "Failed");
    assert_eq!(u(&rec["delivered"]), 0);
    assert_eq!(u(&env.float(&inr).await?["free"]), 900 * M);

    // G9: a holder may off-ramp only their own USDC; credit may pay anyone.
    let lender_usdc = env.balance(env.lender.id()).await?;
    ok(send_payout(
        &env,
        &inr,
        &env.lender,
        50,
        "merchant_share",
        env.priya.id().as_str(),
    )
    .await?)?;
    assert_eq!(
        env.balance(env.lender.id()).await?,
        lender_usdc,
        "refunded in full"
    );
    assert!(env.payout(&inr, 1).await?.is_null());
    ok(send_payout(
        &env,
        &inr,
        &env.lender,
        50,
        "self_offramp",
        env.lender.id().as_str(),
    )
    .await?)?;
    let p = env.payout(&inr, 1).await?;
    assert_eq!(p["status"], "Pending");
    assert_eq!(u(&p["usdc"]), 50 * M);
    assert_eq!(u(&env.float(&inr).await?["payout_pending"]), 50 * M);

    // G10: start at ₹85 (50 USDC = ₹4,250.00), then complete. The USDC joins the float.
    expect_err(
        agent_call(
            &env,
            &inr,
            "start_payout",
            json!({ "payout_id": "1", "inr_paise": "425001", "rate_ppu": RATE }),
        )
        .await?,
        "ERR_AMOUNT_MISMATCH",
    )?;
    ok(agent_call(
        &env,
        &inr,
        "start_payout",
        json!({ "payout_id": "1", "inr_paise": "425000", "rate_ppu": RATE }),
    )
    .await?)?;
    assert_eq!(env.payout(&inr, 1).await?["status"], "Processing");
    ok(agent_call(
        &env,
        &inr,
        "complete_payout",
        json!({ "payout_id": "1", "utr_hash": b58_hash(30) }),
    )
    .await?)?;
    let p = env.payout(&inr, 1).await?;
    assert_eq!(p["status"], "Paid");
    assert_eq!(p["utr_hash"], b58_hash(30));
    let f = env.float(&inr).await?;
    assert_eq!(u(&f["free"]), 950 * M);
    assert_eq!(u(&f["payout_pending"]), 0);
    env.assert_inr_invariant(&inr).await?;

    // G11a: a failed payout refunds the USDC to the beneficiary.
    ok(send_payout(
        &env,
        &inr,
        &env.lender,
        40,
        "self_offramp",
        env.lender.id().as_str(),
    )
    .await?)?;
    let before = env.balance(env.lender.id()).await?;
    ok(agent_call(
        &env,
        &inr,
        "fail_payout",
        json!({ "payout_id": "2", "reason": "no_beneficiary" }),
    )
    .await?)?;
    assert_eq!(env.balance(env.lender.id()).await? - before, 40 * M);
    let p = env.payout(&inr, 2).await?;
    assert_eq!(p["status"], "Failed");
    assert_eq!(p["failure_reason"], "no_beneficiary");

    // G11b: the beneficiary left the token, so the refund fails and becomes claimable.
    let root = env.worker.root_account()?;
    let leaver = root
        .create_subaccount("leaver")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    env.register_usdc(&env.owner, leaver.id()).await?;
    env.mint(leaver.id(), 30).await?;
    ok(send_payout(
        &env,
        &inr,
        &leaver,
        30,
        "self_offramp",
        leaver.id().as_str(),
    )
    .await?)?;
    ok(env
        .call(
            &leaver,
            env.usdc.id(),
            "storage_unregister",
            json!({}),
            ONE_YOCTO,
            30,
        )
        .await?)?;
    let _ = agent_call(
        &env,
        &inr,
        "fail_payout",
        json!({ "payout_id": "3", "reason": "provider_failed" }),
    )
    .await?;
    let claimable: Value = env
        .view(
            inr.contract.id(),
            "get_refund_claimable",
            json!({ "account_id": leaver.id() }),
        )
        .await?;
    assert_eq!(u(&claimable), 30 * M);
    assert_eq!(u(&env.float(&inr).await?["refunds_total"]), 30 * M);
    env.assert_inr_invariant(&inr).await?;
    env.register_usdc(&env.owner, leaver.id()).await?;
    ok(env
        .call(
            &leaver,
            inr.contract.id(),
            "claim_refund",
            json!({}),
            NO_DEPOSIT,
            50,
        )
        .await?)?;
    assert_eq!(env.balance(leaver.id()).await?, 30 * M);
    assert_eq!(u(&env.float(&inr).await?["refunds_total"]), 0);
    env.assert_inr_invariant(&inr).await?;
    env.assert_invariants(&[]).await?;
    Ok(())
}

/// C13, C14 and V14 against the real gateway, then G13 (a rupee loan repayment) and the payout
/// worker's path for a lender withdrawal.
#[tokio::test]
async fn c13_c14_v14_g13_real_gateway() -> Result<()> {
    let env = Env::new(Options::default()).await?;
    env.deposit(&env.lender, 10_000).await?;
    let inr = env.deploy_inr_gateway().await?;
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

    // C13: the merchant share becomes a Pending merchant_share payout. Above the gateway's payout
    // cap it is refused and becomes claimable on credit.
    env.deliver(&s, 1_000 * M).await?;
    ok(env.settle(&s).await?)?;
    let p = env.payout(&inr, 1).await?;
    assert_eq!(p["kind"], "merchant_share");
    assert_eq!(p["beneficiary"], env.priya.id().to_string());
    assert_eq!(u(&p["usdc"]), 1_000 * M);
    assert_eq!(p["status"], "Pending");
    env.deliver(&s, 2_500 * M).await?;
    ok(env.settle(&s).await?)?;
    assert_eq!(u(&env.merchant("priya").await?["claimable"]), 2_500 * M);
    env.assert_inr_invariant(&inr).await?;

    // C14: a refused disbursement fails the loan and releases the liquidity; an accepted one is a
    // Pending loan_disbursement payout.
    env.set_gateway_max_payout(&inr, 100).await?;
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    let _ = env.accept(&env.priya, offer, 500).await?;
    assert_eq!(env.loan(offer + 1).await?["status"], "Failed");
    assert_eq!(u(&env.vault().await?["cash"]), 10_000 * M);
    env.set_gateway_max_payout(&inr, 2_000).await?;
    let offer = env.offer("priya", 500, 700, 1784, Some(1)).await?;
    ok(env.accept(&env.priya, offer, 500).await?)?;
    let loan_id = offer + 1;
    assert_eq!(env.loan(loan_id).await?["status"], "Active");
    let p = env.payout(&inr, 2).await?;
    assert_eq!(p["kind"], "loan_disbursement");
    assert_eq!(p["reference"], loan_id.to_string());
    assert_eq!(u(&p["usdc"]), 500 * M);
    env.assert_invariants(std::slice::from_ref(&s)).await?;

    // G13: a ₹51,000 repayment (600 USDC) repays the 535 owed; 65 USDC returns to the float.
    let free = u(&env.float(&inr).await?["free"]);
    ok(env
        .record_payin(
            &inr,
            40,
            json!({ "type": "repayment", "loan_id": loan_id.to_string() }),
            5_100_000,
            RATE,
        )
        .await?)?;
    let rec = env.receipt(&inr, 40).await?;
    assert_eq!(rec["status"], "Delivered");
    assert_eq!(u(&rec["usdc"]), 600 * M);
    assert_eq!(u(&rec["delivered"]), 535 * M);
    assert_eq!(u(&env.float(&inr).await?["free"]), free - 535 * M);
    assert_eq!(env.loan(loan_id).await?["status"], "Repaid");
    env.assert_inr_invariant(&inr).await?;

    // V14: a refused rupee withdrawal puts the shares back in escrow; the retry is a Pending
    // lender_withdrawal payout.
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
    let req_id = u(&req.json::<Value>()?) as u64;
    env.advance_secs(env.opts.cooldown_sec + 1).await?;
    env.set_gateway_max_payout(&inr, 100).await?;
    let claim = || {
        env.call(
            &env.lender,
            env.credit.id(),
            "claim_withdraw",
            json!({ "request_id": req_id.to_string() }),
            NO_DEPOSIT,
            150,
        )
    };
    let _ = claim().await?;
    let r: Value = env
        .view(
            env.credit.id(),
            "get_withdraw_request",
            json!({ "request_id": req_id.to_string() }),
        )
        .await?;
    assert_eq!(r["status"], "Open");
    assert_eq!(u(&r["shares"]), 1_000 * M);
    env.set_gateway_max_payout(&inr, 2_000).await?;
    ok(claim().await?)?;
    let p = env.payout(&inr, 3).await?;
    assert_eq!(p["kind"], "lender_withdrawal");
    assert_eq!(p["beneficiary"], env.lender.id().to_string());
    let assets = u(&p["usdc"]);
    assert!(
        assets > 1_000 * M,
        "share price rose with the repaid fee: {assets}"
    );

    // The payout worker's path: start at ₹85, then complete with the UTR hash.
    let paise = assets * RATE as u128 / 1_000_000;
    ok(agent_call(
        &env,
        &inr,
        "start_payout",
        json!({ "payout_id": "3", "inr_paise": paise.to_string(), "rate_ppu": RATE }),
    )
    .await?)?;
    ok(agent_call(
        &env,
        &inr,
        "complete_payout",
        json!({ "payout_id": "3", "utr_hash": b58_hash(31) }),
    )
    .await?)?;
    assert_eq!(env.payout(&inr, 3).await?["status"], "Paid");
    let pending: Vec<Value> = env
        .view(inr.contract.id(), "get_pending_payouts", json!({}))
        .await?;
    assert_eq!(pending.len(), 2, "payouts 1 and 2 are still pending");
    env.assert_invariants(&[s]).await?;
    env.assert_inr_invariant(&inr).await?;
    Ok(())
}
