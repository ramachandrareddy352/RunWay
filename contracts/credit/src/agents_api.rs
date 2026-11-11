//! Shade-compatible agent management (same names/arguments as shade-contract-template) plus
//! Runway roles and session keys.

use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use runway_shared::agents::{
    measurements_hash, AgentView, ApprovedView, DstackAttestation, FullMeasurementsHex, Ppid,
};
use runway_shared::events::emit;
use runway_shared::AgentRole;

#[near]
impl Credit {
    pub fn approve_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.assert_owner();
        self.agents.approve_measurements(measurements);
    }

    pub fn remove_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.assert_owner();
        self.agents.remove_measurements(&measurements);
        emit(
            "measurements_removed",
            json!({ "measurements_hash": measurements_hash(&measurements) }),
        );
    }

    pub fn approve_ppids(&mut self, ppids: Vec<Ppid>) {
        self.assert_owner();
        self.agents.approve_ppids(ppids);
    }

    pub fn remove_ppids(&mut self, ppids: Vec<Ppid>) {
        self.assert_owner();
        self.agents.remove_ppids(ppids);
    }

    pub fn whitelist_agent_for_local(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.agents.whitelist_agent_for_local(account_id);
    }

    pub fn remove_agent_from_whitelist_for_local(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.agents
            .remove_agent_from_whitelist_for_local(&account_id);
    }

    /// Called by the agent itself (TEE: implicit account; local: whitelisted account).
    #[payable]
    pub fn register_agent(&mut self, attestation: DstackAttestation) -> bool {
        let m = self.agents.register_agent(attestation);
        emit(
            "agent_registered",
            json!({
                "account_id": env::predecessor_account_id(),
                "measurements_hash": measurements_hash(&m),
            }),
        );
        true
    }

    pub fn remove_agent(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.agents.remove_agent(&account_id);
        emit("agent_removed", json!({ "account_id": account_id }));
    }

    /// Owner assigns (or clears) the role for a measurement set. Agents never choose their role.
    pub fn set_role(&mut self, measurements: FullMeasurementsHex, role: Option<AgentRole>) {
        self.assert_owner();
        self.agents.set_role(&measurements, role);
        emit(
            "role_set",
            json!({ "measurements_hash": measurements_hash(&measurements), "role": role }),
        );
    }

    /// A registered agent publishes its X25519 session key (base58) for encrypted requests.
    pub fn set_session_key(&mut self, pubkey_b58: String, expires_sec: U64) {
        self.agents.set_session_key(pubkey_b58, expires_sec.0);
    }

    pub fn get_agent(&self, account_id: AccountId) -> Option<AgentView> {
        self.agents.get_agent(&account_id)
    }

    pub fn get_approved(&self) -> ApprovedView {
        self.agents.get_approved()
    }

    /// Shade-template compatible view.
    pub fn get_approved_measurements(
        &self,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<FullMeasurementsHex> {
        let v: Vec<_> = self.agents.approved_measurements.iter().cloned().collect();
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.map(|l| l as usize).unwrap_or(v.len());
        v.into_iter().skip(from).take(limit).collect()
    }

    /// Shade-template compatible view.
    pub fn get_approved_ppids(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Ppid> {
        let v: Vec<_> = self.agents.approved_ppids.iter().cloned().collect();
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.map(|l| l as usize).unwrap_or(v.len());
        v.into_iter().skip(from).take(limit).collect()
    }
}
