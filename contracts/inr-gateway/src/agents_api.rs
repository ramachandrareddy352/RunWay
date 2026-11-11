//! Shade-compatible agent management, identical to the credit contract (BUILD_PLAN §9.5/§9.8).

use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use runway_shared::agents::{
    measurements_hash, AgentView, ApprovedView, DstackAttestation, FullMeasurementsHex, Ppid,
};
use runway_shared::events::emit;
use runway_shared::AgentRole;

#[near]
impl InrGateway {
    pub fn approve_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.assert_owner();
        self.agents.approve_measurements(measurements);
    }

    pub fn remove_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.assert_owner();
        self.agents.remove_measurements(&measurements);
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
    }

    pub fn set_role(&mut self, measurements: FullMeasurementsHex, role: Option<AgentRole>) {
        self.assert_owner();
        self.agents.set_role(&measurements, role);
        emit(
            "role_set",
            json!({ "measurements_hash": measurements_hash(&measurements), "role": role }),
        );
    }

    pub fn set_session_key(&mut self, pubkey_b58: String, expires_sec: U64) {
        self.agents.set_session_key(pubkey_b58, expires_sec.0);
    }

    pub fn get_agent(&self, account_id: AccountId) -> Option<AgentView> {
        self.agents.get_agent(&account_id)
    }

    pub fn get_approved(&self) -> ApprovedView {
        self.agents.get_approved()
    }
}
