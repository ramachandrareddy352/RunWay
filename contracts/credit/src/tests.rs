//! Unit tests (no chain): share math, cumulative principal, period rolling, offer bounds, roles,
//! anchors. Cross-contract flows are covered by the sandbox tests in `contracts/tests`.

use super::*;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, Gas, NearToken};
use runway_shared::agents::{
    create_mock_dstack_attestation, create_mock_full_measurements_hex, Ppid,
};
use runway_shared::{AgentRole, Grade, PayoutMode};

const USDC: u128 = 1_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, ts_sec: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("credit.near"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(ts_sec * 1_000_000_000)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

pub(crate) fn test_policy() -> Policy {
    Policy {
        version: 1,
        anchored_caps: [500, 2_000, 5_000, 15_000]
            .iter()
            .map(|v| U128(v * USDC))
            .collect(),
        unanchored_caps: [100, 250, 500, 1_000]
            .iter()
            .map(|v| U128(v * USDC))
            .collect(),
        min_loan: U128(50 * USDC),
        fee_bps_min: 300,
        fee_bps_max: 1500,
        repay_bps_min: 500,
        repay_bps_max: 2500,
        max_utilization_bps: 8000,
        max_exposure_per_merchant: U128(15_000 * USDC),
        daily_new_merchant_exposure: U128(2_000 * USDC),
        min_period_repay_bps: 1000,
        default_after_missed: 2,
        delinquency_provision_bps: 5000,
        protocol_fee_share_bps: 1000,
        merchant_registration_deposit: U128(0),
    }
}

fn time() -> TimeParams {
    TimeParams {
        period_sec: 100,
        withdraw_cooldown_sec: 10,
        offer_ttl_sec: 600,
        policy_timelock_sec: 0,
    }
}

fn contract() -> Credit {
    ctx("owner.near", 1_000, NearToken::from_near(0));
    let mut c = Credit::new(
        acc("owner.near"),
        acc("guardian.near"),
        acc("usdc.near"),
        acc("pay.near"),
        test_policy(),
        time(),
        false,
        U64(86_400_000),
    );
    // A merchant, inserted directly (the factory round-trip is covered by sandbox tests).
    c.merchants.insert(
        "priya".into(),
        Merchant {
            handle: "priya".into(),
            payout: acc("priya.near"),
            settlement: acc("priya.pay.near"),
            payout_mode: PayoutMode::Usdc,
            created_sec: 1_000,
            frozen: false,
            active_loan: None,
            open_offer: None,
            anchor: None,
        },
    );
    c.handle_of.insert(acc("priya.near"), "priya".into());
    c.settlement_of
        .insert(acc("priya.pay.near"), "priya".into());
    c.records.insert("priya".into(), CreditRecord::default());
    c
}

fn with_agent(c: &mut Credit, role: AgentRole) {
    let m = create_mock_full_measurements_hex();
    ctx("owner.near", 1_000, NearToken::from_near(0));
    c.approve_measurements(m.clone());
    c.approve_ppids(vec![Ppid::default()]);
    c.set_role(m, Some(role));
    c.whitelist_agent_for_local(acc("agent.near"));
    ctx("agent.near", 1_000, NearToken::from_millinear(10));
    assert!(c.register_agent(create_mock_dstack_attestation()));
}

fn hash(b: u8) -> Base58CryptoHash {
    Base58CryptoHash::from([b; 32])
}

fn submit(c: &mut Credit, limit_usdc: u128, anchor: Option<Base58CryptoHash>) -> U64 {
    ctx("agent.near", 1_000, NearToken::from_near(0));
    c.submit_offer(
        "priya".into(),
        U128(limit_usdc * USDC),
        700,
        1784,
        Grade::B,
        anchor,
        hash(9),
        None,
        U64(1_500),
        1,
    )
}

/// Inserts an Active loan directly and books it in the vault as if disbursed.
fn active_loan(c: &mut Credit, principal: u128, fee: u128) -> u64 {
    c.cash += principal; // pretend lenders deposited it
    let id = c.next_id();
    c.cash -= principal;
    c.outstanding_principal += principal;
    c.loans.insert(
        id,
        Loan {
            id: U64(id),
            handle: "priya".into(),
            offer_id: U64(0),
            principal: U128(principal),
            fee_bps: 700,
            fee: U128(fee),
            owed: U128(principal + fee),
            repaid: U128(0),
            principal_repaid: U128(0),
            repay_bps: 1784,
            payout_mode: PayoutMode::Usdc,
            status: LoanStatus::Active,
            disbursed_sec: 1_000,
            period_end_sec: 1_100,
            repaid_in_period: U128(0),
            missed: 0,
            provisioned: U128(0),
            written_off: U128(0),
            reserve_drawn: U128(0),
            recovered_lenders: U128(0),
            recovered_reserve: U128(0),
        },
    );
    let mut m = c.merchant("priya");
    m.active_loan = Some(U64(id));
    c.merchants.insert("priya".into(), m);
    id
}

#[test]
fn v6_share_math_and_inflation_resistance() {
    // First deposit mints ~1:1.
    assert_eq!(shares_for_deposit(100 * USDC, 0, 0), 100 * USDC);
    // Attacker deposits 1 micro, donates 1,000,000 USDC to inflate the price; the victim's
    // 100 USDC still mints shares and redeems to almost exactly 100 USDC.
    let attacker = shares_for_deposit(1, 0, 0);
    let assets_after_donation = 1 + 1_000_000 * USDC;
    let victim = shares_for_deposit(100 * USDC, attacker, assets_after_donation);
    assert!(victim > 0);
    let total_shares = attacker + victim;
    let total_assets = assets_after_donation + 100 * USDC;
    let attacker_out = assets_for_shares(attacker, total_shares, total_assets);
    assert!(
        attacker_out < 1 + 1_000_000 * USDC,
        "attacker cannot gain from the donation"
    );
}

#[test]
fn v1_one_repayment() {
    v1_case(1, 100 * USDC, 7 * USDC);
}

#[test]
fn v1_ten_repayments() {
    v1_case(10, 100 * USDC, 7 * USDC);
}

#[test]
fn v1_hundreds_of_dust_repayments() {
    v1_case(500, 107, 7);
}

fn v1_case(n: u128, principal: u128, fee: u128) {
    {
        let mut c = contract();
        let id = active_loan(&mut c, principal, fee);
        let owed = principal + fee;
        let step = (owed / n).max(1);
        let mut paid = 0;
        while paid < owed {
            // One call per repayment (the mock VM, like the real one, caps logs per call).
            ctx("anyone.near", 1_050, NearToken::from_near(0));
            let x = step.min(owed - paid);
            assert_eq!(c.apply_repayment(id, None, x), x);
            paid += x;
            let l = c.loans.get(&id).unwrap();
            assert!(l.principal_repaid.0 <= l.principal.0 && l.repaid.0 <= l.owed.0);
        }
        let l = c.loans.get(&id).unwrap();
        assert_eq!(l.status, LoanStatus::Repaid);
        assert_eq!(l.principal_repaid.0, principal, "principal exactly cleared");
        assert_eq!(c.outstanding_principal, 0);
        assert_eq!(c.record("priya").loans_repaid, 1);
        // Overpayment applies nothing.
        assert_eq!(c.apply_repayment(id, None, 5), 0);
    }
}

#[test]
fn v5_late_check_counts_missed_periods_and_defaults() {
    let mut c = contract();
    c.reserve = 50 * USDC;
    let id = active_loan(&mut c, 500 * USDC, 35 * USDC);
    // Three periods later, nothing repaid: missed reaches 2 -> default. A late lump sum cannot hide it.
    ctx("anyone.near", 1_350, NearToken::from_near(0));
    assert_eq!(c.check_loan(U64(id)), LoanStatus::Defaulted);
    let l = c.loans.get(&id).unwrap();
    assert_eq!(l.written_off.0, 500 * USDC);
    assert_eq!(l.reserve_drawn.0, 50 * USDC);
    assert_eq!(c.reserve, 0);
    assert_eq!(c.outstanding_principal, 0);
    assert_eq!(c.record("priya").loans_defaulted, 1);
    // V4: recovery goes to lenders first, then the reserve, capped at what is owed.
    let cash_before = c.cash;
    let applied = c.apply_repayment(id, None, 1_000 * USDC);
    assert_eq!(applied, 535 * USDC);
    let l = c.loans.get(&id).unwrap();
    assert_eq!(l.recovered_lenders.0, 450 * USDC);
    assert_eq!(l.recovered_reserve.0, 50 * USDC);
    assert!(c.cash > cash_before);
}

#[test]
fn delinquency_books_a_provision_and_cure_reverses_it() {
    let mut c = contract();
    let id = active_loan(&mut c, 500 * USDC, 35 * USDC);
    ctx("anyone.near", 1_150, NearToken::from_near(0)); // one period missed
    assert_eq!(c.check_loan(U64(id)), LoanStatus::Delinquent);
    assert_eq!(c.provisions, 250 * USDC);
    let assets_with_provision = c.total_assets();
    // Repay enough in the current period, then the next boundary cures it.
    c.apply_repayment(id, None, 100 * USDC);
    ctx("anyone.near", 1_205, NearToken::from_near(0));
    assert_eq!(c.check_loan(U64(id)), LoanStatus::Active);
    assert_eq!(c.provisions, 0);
    assert!(c.total_assets() > assets_with_provision);
}

#[test]
fn c7_offer_bounds() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    // Unanchored new merchant: cap 100 USDC.
    let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| submit(&mut c, 101, None)));
    assert!(ok.is_err(), "101 USDC above the unanchored cap");
    let id = submit(&mut c, 100, None);
    assert_eq!(c.offers.get(&id.0).unwrap().status, OfferStatus::Open);
    // Anchored: cap 500; a new offer supersedes the previous one.
    let id2 = submit(&mut c, 500, Some(hash(1)));
    assert_eq!(c.offers.get(&id.0).unwrap().status, OfferStatus::Superseded);
    assert_eq!(c.offers.get(&id2.0).unwrap().limit.0, 500 * USDC);
}

#[test]
#[should_panic(expected = "ERR_BOUNDS_FEE")]
fn c7_fee_out_of_bounds() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    ctx("agent.near", 1_000, NearToken::from_near(0));
    c.submit_offer(
        "priya".into(),
        U128(100 * USDC),
        2_000,
        1784,
        Grade::B,
        None,
        hash(9),
        None,
        U64(1_500),
        1,
    );
}

#[test]
#[should_panic(expected = "ERR_POLICY_VERSION")]
fn c7_wrong_policy_version() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    ctx("agent.near", 1_000, NearToken::from_near(0));
    c.submit_offer(
        "priya".into(),
        U128(100 * USDC),
        700,
        1784,
        Grade::B,
        None,
        hash(9),
        None,
        U64(1_500),
        2,
    );
}

#[test]
#[should_panic(expected = "ERR_ROLE")]
fn c4_wrong_role_cannot_submit() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Risk);
    submit(&mut c, 100, None);
}

#[test]
#[should_panic(expected = "ERR_AGENT_INVALID")]
fn c5_removed_measurements_invalidate_agent() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    ctx("owner.near", 1_000, NearToken::from_near(0));
    c.remove_measurements(create_mock_full_measurements_hex());
    submit(&mut c, 100, None);
}

#[test]
#[should_panic(expected = "ERR_AGENT_INVALID")]
fn c10_removed_ppid_invalidates_agent() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    ctx("owner.near", 1_000, NearToken::from_near(0));
    c.remove_ppids(vec![Ppid::default()]);
    submit(&mut c, 100, None);
}

#[test]
#[should_panic(expected = "ERR_ANCHOR_TAKEN")]
fn c8_anchor_reuse_rejected() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    submit(&mut c, 500, Some(hash(1)));
    // A second merchant tries the same anchor.
    c.merchants.insert(
        "ravi".into(),
        Merchant {
            handle: "ravi".into(),
            payout: acc("ravi.near"),
            settlement: acc("ravi.pay.near"),
            ..c.merchant("priya")
        },
    );
    c.records.insert("ravi".into(), CreditRecord::default());
    ctx("agent.near", 1_000, NearToken::from_near(0));
    c.submit_offer(
        "ravi".into(),
        U128(100 * USDC),
        700,
        1784,
        Grade::B,
        Some(hash(1)),
        hash(9),
        None,
        U64(1_500),
        1,
    );
}

#[test]
fn c12_session_key_only_for_agents() {
    let mut c = contract();
    with_agent(&mut c, AgentRole::Underwriter);
    ctx("agent.near", 1_000, NearToken::from_near(0));
    c.set_session_key(
        "SessionPub11111111111111111111111111111111111".into(),
        U64(2_000),
    );
    assert_eq!(
        c.get_agent(acc("agent.near"))
            .unwrap()
            .session_pub
            .as_deref(),
        Some("SessionPub11111111111111111111111111111111111")
    );
    ctx("mallory.near", 1_000, NearToken::from_near(0));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.set_session_key("X".into(), U64(1))
    }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "Whitelisting agents is not supported for TEE")]
fn c11_no_local_whitelist_in_tee_mode() {
    ctx("owner.near", 1_000, NearToken::from_near(0));
    let mut c = Credit::new(
        acc("owner.near"),
        acc("guardian.near"),
        acc("usdc.near"),
        acc("pay.near"),
        test_policy(),
        time(),
        true,
        U64(1),
    );
    c.whitelist_agent_for_local(acc("agent.near"));
}

#[test]
fn v13_deposit_for_mints_to_beneficiary_and_refunds_unregistered() {
    let mut c = contract();
    c.shares.internal_register_account(&acc("investor.near"));
    ctx("usdc.near", 1_000, NearToken::from_near(0));
    let r = c.ft_on_transfer(
        acc("gateway.near"),
        U128(100 * USDC),
        r#"{"action":"deposit_for","beneficiary":"investor.near"}"#.into(),
    );
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(U128(0))));
    assert_eq!(
        c.shares.internal_unwrap_balance_of(&acc("investor.near")),
        100 * USDC
    );
    assert_eq!(c.shares.accounts.get(&acc("gateway.near")), None);
    // Unregistered beneficiary: full refund, nothing minted.
    let r = c.ft_on_transfer(
        acc("gateway.near"),
        U128(5 * USDC),
        r#"{"action":"deposit_for","beneficiary":"nobody.near"}"#.into(),
    );
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(U128(v)) if v == 5 * USDC));
    assert_eq!(c.cash, 100 * USDC);
}

#[test]
#[should_panic(expected = "ERR_NOT_TOKEN")]
fn v7_only_usdc_can_call_ft_on_transfer() {
    let mut c = contract();
    ctx("fake-usdc.near", 1_000, NearToken::from_near(0));
    let _ = c.ft_on_transfer(
        acc("lender.near"),
        U128(1),
        r#"{"action":"deposit"}"#.into(),
    );
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn v12_seed_reserve_owner_only() {
    let mut c = contract();
    ctx("usdc.near", 1_000, NearToken::from_near(0));
    let _ = c.ft_on_transfer(
        acc("mallory.near"),
        U128(1),
        r#"{"action":"seed_reserve"}"#.into(),
    );
}

#[test]
fn settle_from_unknown_account_and_replay_are_rejected() {
    let mut c = contract();
    ctx("usdc.near", 1_000, NearToken::from_near(0));
    let msg = r#"{"action":"settle","op_id":"1","loan_id":null,"repay":"0","payout":"10"}"#;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ft_on_transfer(acc("random.near"), U128(10), msg.into())
    }));
    assert!(r.is_err(), "unregistered settlement");
    c.last_op.insert(acc("priya.pay.near"), 5);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ft_on_transfer(acc("priya.pay.near"), U128(10), msg.into())
    }));
    assert!(r.is_err(), "op_id must exceed last_op");
}
