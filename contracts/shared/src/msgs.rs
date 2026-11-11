//! `ft_on_transfer` messages and shared enums (BUILD_PLAN §9.2).

use near_sdk::{
    json_types::{U128, U64},
    near, serde_json, AccountId,
};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum FtMsg {
    /// Lender deposit; shares go to the sender.
    Deposit,
    /// Deposit on behalf of `beneficiary` (used by the INR gateway for rupee investors).
    DepositFor { beneficiary: AccountId },
    /// Owner seeds the first-loss reserve.
    SeedReserve,
    /// Voluntary repayment by anyone.
    Repay { loan_id: U64 },
    /// Sent by a settlement account: one transfer carrying the repay and payout split.
    Settle {
        op_id: U64,
        loan_id: Option<U64>,
        repay: U128,
        payout: U128,
    },
    /// INR gateway: add USDC float.
    FundFloat,
    /// INR gateway: pay `beneficiary` in rupees.
    InrPayout {
        kind: PayoutKind,
        beneficiary: AccountId,
        reference: String,
    },
}

impl FtMsg {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("FtMsg serializes")
    }
    pub fn parse(msg: &str) -> Option<Self> {
        serde_json::from_str(msg).ok()
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PayoutKind {
    MerchantShare,
    LoanDisbursement,
    LenderWithdrawal,
    SelfOfframp,
}

/// How a merchant receives money (credit contract, per merchant).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PayoutMode {
    #[default]
    Usdc,
    Inr,
}

/// How a lender receives a withdrawal.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum WithdrawPayout {
    #[default]
    Usdc,
    Inr,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRole {
    Underwriter,
    Risk,
    InrGateway,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grade {
    A,
    B,
    C,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rt(json: &str) -> FtMsg {
        let m = FtMsg::parse(json).expect(json);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&m.to_json()).unwrap(),
            serde_json::from_str::<serde_json::Value>(json).unwrap(),
            "round trip of {json}"
        );
        m
    }

    #[test]
    fn exact_json_strings() {
        assert_eq!(rt(r#"{"action":"deposit"}"#), FtMsg::Deposit);
        assert_eq!(rt(r#"{"action":"seed_reserve"}"#), FtMsg::SeedReserve);
        assert_eq!(
            rt(r#"{"action":"repay","loan_id":"7"}"#),
            FtMsg::Repay { loan_id: U64(7) }
        );
        assert_eq!(
            rt(
                r#"{"action":"settle","op_id":"42","loan_id":"7","repay":"178400000","payout":"821600000"}"#
            ),
            FtMsg::Settle {
                op_id: U64(42),
                loan_id: Some(U64(7)),
                repay: U128(178_400_000),
                payout: U128(821_600_000)
            }
        );
        rt(r#"{"action":"settle","op_id":"43","loan_id":null,"repay":"0","payout":"5000000"}"#);
        rt(r#"{"action":"deposit_for","beneficiary":"investor.testnet"}"#);
        rt(r#"{"action":"fund_float"}"#);
        rt(
            r#"{"action":"inr_payout","kind":"merchant_share","beneficiary":"priya.testnet","reference":"priya"}"#,
        );
        rt(
            r#"{"action":"inr_payout","kind":"loan_disbursement","beneficiary":"priya.testnet","reference":"12"}"#,
        );
        rt(
            r#"{"action":"inr_payout","kind":"lender_withdrawal","beneficiary":"investor.testnet","reference":"5"}"#,
        );
        assert!(FtMsg::parse(r#"{"action":"unknown"}"#).is_none());
        assert!(FtMsg::parse("not json").is_none());
    }
}
