//! Offers from attested underwriters, checked against hard policy bounds (design §7.5).

use crate::*;
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use runway_shared::events::emit;
use runway_shared::{AgentRole, Grade};

#[near]
impl Credit {
    /// Underwriter agents only. Even a fully compromised agent cannot exceed these bounds.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_offer(
        &mut self,
        handle: String,
        limit: U128,
        fee_bps: u16,
        repay_bps: u16,
        grade: Grade,
        anchor_hash: Option<Base58CryptoHash>,
        inputs_commitment: Base58CryptoHash,
        llm_receipt_hash: Option<Base58CryptoHash>,
        expires_at_sec: U64,
        policy_version: u32,
    ) -> U64 {
        let agent = env::predecessor_account_id();
        let measurements_hash = self.agents.require_role(&agent, AgentRole::Underwriter);
        require!(!self.paused_new_lending, ERR_PAUSED);
        let mut m = self.merchant(&handle);
        let record = self.record(&handle);
        require!(!m.frozen, ERR_FROZEN);
        require!(record.loans_defaulted == 0, ERR_DEFAULTED);
        require!(m.active_loan.is_none(), ERR_ACTIVE_LOAN);
        require!(policy_version == self.policy.version, ERR_POLICY_VERSION);
        let now = now_sec();
        require!(
            expires_at_sec.0 > now && expires_at_sec.0 <= now + self.time.offer_ttl_sec,
            ERR_OFFER_EXPIRED
        );

        if let Some(h) = anchor_hash {
            match self.anchors.get(&h) {
                Some(owner) => require!(owner == &handle, ERR_ANCHOR_TAKEN),
                None => {
                    self.anchors.insert(h, handle.clone());
                }
            }
            m.anchor = Some(h);
        }
        let p = &self.policy;
        let cap = p.cap(m.anchor.is_some(), record.loans_repaid);
        require!(
            limit.0 >= p.min_loan.0 && limit.0 <= cap && limit.0 <= p.max_exposure_per_merchant.0,
            ERR_BOUNDS_LIMIT
        );
        require!(
            fee_bps >= p.fee_bps_min && fee_bps <= p.fee_bps_max,
            ERR_BOUNDS_FEE
        );
        require!(
            repay_bps >= p.repay_bps_min && repay_bps <= p.repay_bps_max,
            ERR_BOUNDS_REPAY
        );

        if let Some(prev) = m.open_offer {
            if let Some(mut o) = self.offers.get(&prev.0).cloned() {
                if o.status == OfferStatus::Open {
                    o.status = OfferStatus::Superseded;
                    self.offers.insert(prev.0, o);
                }
            }
        }
        let id = self.next_id();
        let offer = Offer {
            id: U64(id),
            handle: handle.clone(),
            limit,
            fee_bps,
            repay_bps,
            grade,
            anchor_hash,
            inputs_commitment,
            llm_receipt_hash,
            agent: agent.clone(),
            measurements_hash: measurements_hash.clone(),
            policy_version,
            created_sec: now,
            expires_at_sec: expires_at_sec.0,
            status: OfferStatus::Open,
        };
        self.offers.insert(id, offer);
        m.open_offer = Some(U64(id));
        self.merchants.insert(handle.clone(), m);
        emit(
            "offer_submitted",
            json!({
                "offer_id": U64(id), "handle": handle, "limit": limit, "grade": grade,
                "fee_bps": fee_bps, "repay_bps": repay_bps, "anchored": anchor_hash.is_some(),
                "inputs_commitment": inputs_commitment, "measurements_hash": measurements_hash,
                "agent": agent,
            }),
        );
        U64(id)
    }
}
