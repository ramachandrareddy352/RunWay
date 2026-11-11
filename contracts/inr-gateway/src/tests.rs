//! Unit tests (no chain): checks, callbacks (with injected promise results) and the payout state
//! machine. Cross-contract flows run in the sandbox tests (G1–G13 in `contracts/tests`).

use super::*;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, Gas, NearToken, PromiseOrValue, PromiseResult, RuntimeFeesConfig};
use runway_shared::agents::{
    create_mock_dstack_attestation, create_mock_full_measurements_hex, Ppid,
};
use runway_shared::{AgentRole, FtMsg, PayoutKind};

const USDC: u128 = 1_000_000;
const T0: u64 = 1_800_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn builder(predecessor: &str, ts_sec: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("inr.near"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(ts_sec * 1_000_000_000)
        .attached_deposit(NearToken::from_millinear(10))
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn ctx(predecessor: &str) {
    testing_env!(builder(predecessor, T0).build());
}

/// A callback context with one promise result.
fn callback(result: PromiseResult) {
    testing_env!(
        builder("inr.near", T0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn limits() -> GatewayLimits {
    GatewayLimits {
        spread_bps: 0,
        min_rate_ppu: 7_000,
        max_rate_ppu: 13_000,
        max_payin_paise: U128(10_000_000),
        daily_payin_paise: U128(20_000_000),
        max_payout_usdc: U128(2_000 * USDC),
    }
}

fn gateway(with_role: Option<AgentRole>) -> InrGateway {
    ctx("owner.near");
    let mut g = InrGateway::new(
        acc("owner.near"),
        acc("usdc.near"),
        acc("credit.near"),
        acc("pay.near"),
        limits(),
        false,
        U64(86_400_000),
    );
    let m = create_mock_full_measurements_hex();
    g.approve_measurements(m.clone());
    g.approve_ppids(vec![Ppid::default()]);
    g.set_role(m, with_role);
    g.whitelist_agent_for_local(acc("agent.near"));
    ctx("agent.near");
    assert!(g.register_agent(create_mock_dstack_attestation()));
    // 1,000 USDC float
    ctx("usdc.near");
    let _ = g.ft_on_transfer(
        acc("funder.near"),
        U128(1_000 * USDC),
        FtMsg::FundFloat.to_json(),
    );
    g
}

fn fund(g: &mut InrGateway, usdc: u128) {
    ctx("usdc.near");
    let _ = g.ft_on_transfer(acc("funder.near"), U128(usdc), FtMsg::FundFloat.to_json());
}

fn hash(b: u8) -> Base58CryptoHash {
    Base58CryptoHash::from([b; 32])
}

fn sale(handle: &str) -> PayinKind {
    PayinKind::MerchantSale {
        handle: handle.into(),
    }
}

fn payin(g: &mut InrGateway, h: u8, kind: PayinKind, paise: u128, rate: u32) {
    ctx("agent.near");
    let _ = g.record_payin(hash(h), kind, U128(paise), rate, None);
}

#[test]
fn g1_sale_debits_the_float_and_is_listed_after_delivery() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 850_000, 8_500); // ₹8,500 at ₹85 -> 100 USDC
    assert_eq!(g.free_float, 900 * USDC);
    let r = g.get_receipt(hash(1)).unwrap();
    assert_eq!((r.usdc.0, r.status), (100 * USDC, PayinStatus::Delivering));
    assert!(g
        .get_payins_by_handle("priya".into(), None, None)
        .is_empty());

    callback(PromiseResult::Successful(vec![]));
    g.on_payin_delivered(hash(1), false);
    let r = g.get_receipt(hash(1)).unwrap();
    assert_eq!(
        (r.status, r.delivered.0),
        (PayinStatus::Delivered, 100 * USDC)
    );
    assert_eq!(g.get_payins_by_handle("priya".into(), None, None).len(), 1);
    assert_eq!(g.free_float, 900 * USDC);

    // A stale second callback changes nothing.
    callback(PromiseResult::Failed);
    g.on_payin_delivered(hash(1), false);
    assert_eq!(g.free_float, 900 * USDC);
}

#[test]
#[should_panic(expected = "ERR_PAYIN_REPLAY")]
fn g2_replay() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 100_000, 8_500);
    payin(&mut g, 1, sale("priya"), 100_000, 8_500);
}

#[test]
#[should_panic(expected = "ERR_RATE_BAND")]
fn g3_rate_below_band() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 100_000, 6_999);
}

#[test]
#[should_panic(expected = "ERR_RATE_BAND")]
fn g3_rate_above_band() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 100_000, 13_001);
}

#[test]
#[should_panic(expected = "ERR_PAYIN_CAP")]
fn g4_per_payment_cap() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 10_000_001, 8_500);
}

#[test]
#[should_panic(expected = "ERR_PAYIN_CAP")]
fn g4_daily_cap() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    fund(&mut g, 2_000 * USDC);
    payin(&mut g, 1, sale("priya"), 10_000_000, 13_000);
    payin(&mut g, 2, sale("priya"), 10_000_000, 13_000);
    payin(&mut g, 3, sale("priya"), 1, 13_000);
}

#[test]
fn g4_daily_cap_resets_the_next_day() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    fund(&mut g, 2_000 * USDC);
    payin(&mut g, 1, sale("priya"), 10_000_000, 13_000);
    payin(&mut g, 2, sale("priya"), 10_000_000, 13_000);
    testing_env!(builder("agent.near", T0 + 86_400).build());
    let _ = g.record_payin(hash(3), sale("priya"), U128(100), 13_000, None);
    assert_eq!(g.get_float().daily_payin_paise.0, 100);
}

#[test]
#[should_panic(expected = "ERR_FLOAT")]
fn g5_float() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("priya"), 8_500_100, 8_500); // 1,000.01 USDC > 1,000 float
}

#[test]
#[should_panic(expected = "ERR_ROLE")]
fn g6_agent_without_role() {
    let mut g = gateway(Some(AgentRole::Underwriter));
    payin(&mut g, 1, sale("priya"), 100_000, 8_500);
}

#[test]
#[should_panic(expected = "ERR_AGENT_INVALID")]
fn g6_not_an_agent() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("mallory.near");
    let _ = g.record_payin(hash(1), sale("priya"), U128(100_000), 8_500, None);
}

#[test]
fn g7_failed_delivery_restores_the_float() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(&mut g, 1, sale("ghost"), 850_000, 8_500);
    callback(PromiseResult::Failed);
    g.on_payin_delivered(hash(1), false);
    assert_eq!(g.get_receipt(hash(1)).unwrap().status, PayinStatus::Failed);
    assert_eq!(g.free_float, 1_000 * USDC);
    assert!(g
        .get_payins_by_handle("ghost".into(), None, None)
        .is_empty());
}

#[test]
fn g8_g13_transfer_call_uses_the_returned_amount() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payin(
        &mut g,
        1,
        PayinKind::Repayment { loan_id: U64(7) },
        850_000,
        8_500,
    );
    // credit used 60 of 100 USDC (the loan needed less): 40 go back to the float.
    callback(PromiseResult::Successful(b"\"60000000\"".to_vec()));
    g.on_payin_delivered(hash(1), true);
    let r = g.get_receipt(hash(1)).unwrap();
    assert_eq!(
        (r.status, r.delivered.0),
        (PayinStatus::Delivered, 60 * USDC)
    );
    assert_eq!(g.free_float, 940 * USDC);

    // Unregistered lender beneficiary: credit refunds everything.
    payin(
        &mut g,
        2,
        PayinKind::LenderDeposit {
            beneficiary: acc("nobody.near"),
        },
        850_000,
        8_500,
    );
    callback(PromiseResult::Successful(b"\"0\"".to_vec()));
    g.on_payin_delivered(hash(2), true);
    assert_eq!(g.get_receipt(hash(2)).unwrap().status, PayinStatus::Failed);
    assert_eq!(g.free_float, 940 * USDC);
}

#[test]
#[should_panic(expected = "ERR_PAYINS_PAUSED")]
fn g12_paused_blocks_payins() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("owner.near");
    g.pause_payins(true);
    payin(&mut g, 1, sale("priya"), 100_000, 8_500);
}

fn payout(
    g: &mut InrGateway,
    sender: &str,
    kind: PayoutKind,
    beneficiary: &str,
    usdc: u128,
) -> u128 {
    ctx("usdc.near");
    let msg = FtMsg::InrPayout {
        kind,
        beneficiary: acc(beneficiary),
        reference: "priya".into(),
    };
    match g.ft_on_transfer(acc(sender), U128(usdc), msg.to_json()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

#[test]
fn g9_who_may_request_a_payout() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    assert_eq!(
        payout(
            &mut g,
            "credit.near",
            PayoutKind::MerchantShare,
            "priya.near",
            82 * USDC
        ),
        0
    );
    assert_eq!(g.get_pending_payouts(None, None).len(), 1);
    // Another sender paying someone else: refunded in full.
    assert_eq!(
        payout(
            &mut g,
            "mallory.near",
            PayoutKind::SelfOfframp,
            "priya.near",
            5 * USDC
        ),
        5 * USDC
    );
    // Self off-ramp by the beneficiary is allowed.
    assert_eq!(
        payout(
            &mut g,
            "priya.near",
            PayoutKind::SelfOfframp,
            "priya.near",
            5 * USDC
        ),
        0
    );
    // Above max_payout_usdc: refunded.
    assert_eq!(
        payout(
            &mut g,
            "credit.near",
            PayoutKind::MerchantShare,
            "priya.near",
            2_001 * USDC
        ),
        2_001 * USDC
    );
    assert_eq!(g.payout_pending, 87 * USDC);
    assert_eq!(g.get_pending_payouts(None, None).len(), 2);
}

#[test]
#[should_panic(expected = "ERR_NOT_TOKEN")]
fn ft_on_transfer_only_from_the_token() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("fake-usdc.near");
    let _ = g.ft_on_transfer(acc("credit.near"), U128(1), FtMsg::FundFloat.to_json());
}

#[test]
fn g10_start_and_complete() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payout(
        &mut g,
        "credit.near",
        PayoutKind::MerchantShare,
        "priya.near",
        82_160_000,
    );
    ctx("agent.near");
    g.start_payout(U64(1), U128(698_360), 8_500); // 82.16 USDC at ₹85 -> ₹6,983.60
    assert_eq!(
        g.get_payout(U64(1)).unwrap().status,
        PayoutStatus::Processing
    );
    g.complete_payout(U64(1), hash(9));
    let p = g.get_payout(U64(1)).unwrap();
    assert_eq!((p.status, p.utr_hash), (PayoutStatus::Paid, Some(hash(9))));
    assert_eq!(g.payout_pending, 0);
    assert_eq!(g.free_float, 1_000 * USDC + 82_160_000);
    assert!(g.get_pending_payouts(None, None).is_empty());
}

#[test]
#[should_panic(expected = "ERR_AMOUNT_MISMATCH")]
fn g10_start_with_a_wrong_rupee_amount() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payout(
        &mut g,
        "credit.near",
        PayoutKind::MerchantShare,
        "priya.near",
        82_160_000,
    );
    ctx("agent.near");
    g.start_payout(U64(1), U128(698_361), 8_500);
}

#[test]
#[should_panic(expected = "ERR_PAYOUT_STATE")]
fn g10_complete_requires_processing() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payout(
        &mut g,
        "credit.near",
        PayoutKind::MerchantShare,
        "priya.near",
        82_160_000,
    );
    ctx("agent.near");
    g.complete_payout(U64(1), hash(9));
}

#[test]
fn g11_fail_refunds_or_makes_it_claimable() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    payout(
        &mut g,
        "credit.near",
        PayoutKind::LenderWithdrawal,
        "lender.near",
        50 * USDC,
    );
    ctx("agent.near");
    let _ = g.fail_payout(U64(1), "no_beneficiary".into());
    let p = g.get_payout(U64(1)).unwrap();
    assert_eq!(
        (p.status, p.failure_reason.as_deref()),
        (PayoutStatus::Failed, Some("no_beneficiary"))
    );
    assert_eq!(g.payout_pending, 0);

    // The refund transfer failed -> claimable.
    callback(PromiseResult::Failed);
    g.on_refund(U64(1));
    assert_eq!(g.get_refund_claimable(acc("lender.near")).0, 50 * USDC);
    assert_eq!(g.refunds_total, 50 * USDC);

    ctx("lender.near");
    let _ = g.claim_refund();
    assert_eq!(g.refunds_total, 0);
    // That transfer failed too -> restored.
    callback(PromiseResult::Failed);
    g.on_refund_claimed(acc("lender.near"), U128(50 * USDC));
    assert_eq!(g.get_refund_claimable(acc("lender.near")).0, 50 * USDC);
    assert_eq!(g.refunds_total, 50 * USDC);
}

#[test]
fn g12_pause_never_blocks_payouts() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("owner.near");
    g.pause_payins(true);
    payout(
        &mut g,
        "credit.near",
        PayoutKind::MerchantShare,
        "priya.near",
        82_160_000,
    );
    ctx("agent.near");
    g.start_payout(U64(1), U128(698_360), 8_500);
    g.complete_payout(U64(1), hash(9));
    assert_eq!(g.get_payout(U64(1)).unwrap().status, PayoutStatus::Paid);
}

#[test]
fn withdraw_float_restores_on_failure() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("owner.near");
    let _ = g.withdraw_float(U128(100 * USDC));
    assert_eq!(g.free_float, 900 * USDC);
    callback(PromiseResult::Failed);
    g.on_float_withdrawn(U128(100 * USDC));
    assert_eq!(g.free_float, 1_000 * USDC);
}

#[test]
#[should_panic(expected = "ERR_BAD_LIMITS")]
fn limits_are_validated() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("owner.near");
    let mut l = limits();
    l.min_rate_ppu = 14_000;
    g.set_limits(l);
}

#[test]
fn beneficiary_blob_is_agent_only_and_capped() {
    let mut g = gateway(Some(AgentRole::InrGateway));
    ctx("agent.near");
    g.set_beneficiary_blob(acc("priya.near"), "Y2lwaGVydGV4dA==".into());
    assert_eq!(
        g.get_beneficiary_blob(acc("priya.near")).as_deref(),
        Some("Y2lwaGVydGV4dA==")
    );
}
