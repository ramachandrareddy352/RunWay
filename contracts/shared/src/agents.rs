//! Shade-compatible TEE agent registry (design §6.8, BUILD_PLAN T1.1).
//!
//! Mirrors `NearDeFi/shade-agent-framework/shade-contract-template` so the `shade` CLI works unmodified:
//! same method names and argument shapes (`approve_measurements`, `approve_ppids`, `register_agent`, …),
//! same `report_data` layout (32-byte implicit account id + zeros), same local mode (whitelist + mock
//! measurements/PPID). Runway additions: owner-assigned roles per measurement set, and an X25519 session
//! key each agent publishes on-chain.

use crate::errors::*;
use crate::msgs::AgentRole;
use near_sdk::{
    borsh, env,
    json_types::U64,
    near, require,
    store::{IterableMap, IterableSet, LookupMap},
    AccountId,
};
pub use shade_attestation::attestation::{create_mock_dstack_attestation, DstackAttestation};
pub use shade_attestation::measurements::{create_mock_full_measurements_hex, FullMeasurementsHex};
use shade_attestation::{
    attestation::AcceptedDstackAttestation, measurements::FullMeasurements,
    report_data::ReportData, tcb_info::HexBytes,
};

pub type Ppid = HexBytes<16>;

/// Same as the template's `STORAGE_BYTES_TO_REGISTER` budget (shade-agent-js attaches 0.005 NEAR).
pub const STORAGE_BYTES_TO_REGISTER: u128 = 500;

#[near(serializers = [borsh])]
pub struct Agent {
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: u64,
    pub session_pub: Option<String>,
    pub session_expires_sec: u64,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub account_id: AccountId,
    pub measurements: FullMeasurementsHex,
    pub measurements_hash: String,
    pub ppid: Ppid,
    pub valid_until_ms: U64,
    pub role: Option<AgentRole>,
    pub valid: bool,
    pub session_pub: Option<String>,
    pub session_expires_sec: U64,
}

#[near(serializers = [json])]
pub struct ApprovedMeasurement {
    pub measurements: FullMeasurementsHex,
    pub measurements_hash: String,
    pub role: Option<AgentRole>,
}

#[near(serializers = [json])]
pub struct ApprovedView {
    pub requires_tee: bool,
    pub attestation_expiration_time_ms: U64,
    pub measurements: Vec<ApprovedMeasurement>,
    pub ppids: Vec<Ppid>,
    pub whitelisted_agents_for_local: Vec<AccountId>,
}

#[near(serializers = [borsh])]
pub struct AgentRegistry {
    pub requires_tee: bool,
    pub attestation_expiration_time_ms: u64,
    pub approved_measurements: IterableSet<FullMeasurementsHex>,
    pub approved_ppids: IterableSet<Ppid>,
    pub whitelisted_agents_for_local: IterableSet<AccountId>,
    /// measurements hash (hex sha256 of borsh) -> role
    pub roles: LookupMap<String, AgentRole>,
    pub agents: IterableMap<AccountId, Agent>,
}

fn key(prefix: &[u8], tag: u8) -> Vec<u8> {
    let mut k = prefix.to_vec();
    k.push(tag);
    k
}

/// Hex sha256 of the borsh encoding of a measurement set. Used as the role-map key.
pub fn measurements_hash(m: &FullMeasurementsHex) -> String {
    hex::encode(env::sha256(
        borsh::to_vec(m).expect("measurements serialize"),
    ))
}

impl AgentRegistry {
    pub fn new(prefix: &[u8], requires_tee: bool, attestation_expiration_time_ms: u64) -> Self {
        Self {
            requires_tee,
            attestation_expiration_time_ms,
            approved_measurements: IterableSet::new(key(prefix, b'm')),
            approved_ppids: IterableSet::new(key(prefix, b'p')),
            whitelisted_agents_for_local: IterableSet::new(key(prefix, b'w')),
            roles: LookupMap::new(key(prefix, b'r')),
            agents: IterableMap::new(key(prefix, b'a')),
        }
    }

    // ---- owner operations (caller checks ownership) ----

    pub fn approve_measurements(&mut self, m: FullMeasurementsHex) {
        self.approved_measurements.insert(m);
    }

    pub fn remove_measurements(&mut self, m: &FullMeasurementsHex) {
        require!(
            self.approved_measurements.remove(m),
            "Measurements not in approved list"
        );
    }

    pub fn approve_ppids(&mut self, ppids: Vec<Ppid>) {
        for p in ppids {
            self.approved_ppids.insert(p);
        }
    }

    pub fn remove_ppids(&mut self, ppids: Vec<Ppid>) {
        for p in ppids {
            require!(self.approved_ppids.remove(&p), "PPID not in approved list");
        }
    }

    pub fn set_role(&mut self, m: &FullMeasurementsHex, role: Option<AgentRole>) {
        let h = measurements_hash(m);
        match role {
            Some(r) => {
                self.roles.insert(h, r);
            }
            None => {
                self.roles.remove(&h);
            }
        }
    }

    pub fn whitelist_agent_for_local(&mut self, account_id: AccountId) {
        require!(
            !self.requires_tee,
            "Whitelisting agents is not supported for TEE"
        );
        self.whitelisted_agents_for_local.insert(account_id);
    }

    pub fn remove_agent_from_whitelist_for_local(&mut self, account_id: &AccountId) {
        require!(
            !self.requires_tee,
            "Removing agents from the whitelist is not supported for TEE"
        );
        require!(
            self.whitelisted_agents_for_local.remove(account_id),
            "Agent not in whitelist for local"
        );
    }

    pub fn remove_agent(&mut self, account_id: &AccountId) {
        require!(
            self.agents.remove(account_id).is_some(),
            "Agent not registered"
        );
    }

    // ---- agent operations ----

    /// Verifies the caller's attestation (or local whitelist) and registers it. Returns the matched
    /// measurements. Requires the caller to attach storage for new registrations.
    pub fn register_agent(&mut self, attestation: DstackAttestation) -> FullMeasurementsHex {
        let predecessor = env::predecessor_account_id();
        if self.agents.get(&predecessor).is_none() {
            let cost = env::storage_byte_cost()
                .checked_mul(STORAGE_BYTES_TO_REGISTER)
                .expect("storage cost");
            require!(
                env::attached_deposit() >= cost,
                format!(
                    "Attached deposit must be greater than storage cost {}",
                    cost.exact_amount_display()
                )
            );
        }
        let (measurements, ppid) = self.verify_attestation(&predecessor, attestation);
        let valid_until_ms = env::block_timestamp_ms() + self.attestation_expiration_time_ms;
        self.agents.insert(
            predecessor,
            Agent {
                measurements: measurements.clone(),
                ppid,
                valid_until_ms,
                session_pub: None,
                session_expires_sec: 0,
            },
        );
        measurements
    }

    fn verify_attestation(
        &self,
        predecessor: &AccountId,
        attestation: DstackAttestation,
    ) -> (FullMeasurementsHex, Ppid) {
        if self.requires_tee {
            let id = predecessor.as_str();
            require!(
                id.len() == 64
                    && id
                        .chars()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
                "Account ID must be implicit account"
            );
            let id_bytes = hex::decode(id).expect("Failed to decode account ID");
            let mut report = [0u8; 64];
            report[..32].copy_from_slice(&id_bytes);
            let expected: Vec<FullMeasurements> = self
                .approved_measurements
                .iter()
                .cloned()
                .map(Into::into)
                .collect();
            let ppids: Vec<Ppid> = self.approved_ppids.iter().cloned().collect();
            match attestation.verify(
                ReportData::from(report),
                env::block_timestamp_ms() / 1000,
                &expected,
                &ppids,
            ) {
                Ok(AcceptedDstackAttestation {
                    measurements, ppid, ..
                }) => (measurements.into(), ppid),
                Err(e) => env::panic_str(&format!("Attestation verification failed: {e}")),
            }
        } else {
            require!(
                self.whitelisted_agents_for_local.contains(predecessor),
                "Agent needs to be whitelisted for local mode"
            );
            let m = create_mock_full_measurements_hex();
            require!(
                self.approved_measurements.contains(&m),
                "Default measurements must be approved for local mode"
            );
            require!(
                self.approved_ppids.contains(&Ppid::default()),
                "Default PPID must be approved for local mode"
            );
            (m, Ppid::default())
        }
    }

    pub fn set_session_key(&mut self, pubkey_b58: String, expires_sec: u64) {
        let account = env::predecessor_account_id();
        self.require_valid(&account);
        require!(
            !pubkey_b58.is_empty() && pubkey_b58.len() <= 64,
            ERR_BAD_MSG
        );
        let agent = self.agents.get_mut(&account).expect(ERR_AGENT_INVALID);
        agent.session_pub = Some(pubkey_b58);
        agent.session_expires_sec = expires_sec;
    }

    // ---- checks ----

    fn is_valid(&self, account: &AccountId, agent: &Agent) -> bool {
        agent.valid_until_ms >= env::block_timestamp_ms()
            && self.approved_measurements.contains(&agent.measurements)
            && self.approved_ppids.contains(&agent.ppid)
            && (self.requires_tee || self.whitelisted_agents_for_local.contains(account))
    }

    /// Panics with `ERR_AGENT_INVALID` unless `account` is a registered, unexpired agent whose
    /// measurements and PPID are still approved.
    pub fn require_valid(&self, account: &AccountId) -> &Agent {
        let agent = self
            .agents
            .get(account)
            .unwrap_or_else(|| env::panic_str(ERR_AGENT_INVALID));
        require!(self.is_valid(account, agent), ERR_AGENT_INVALID);
        agent
    }

    /// Like `require_valid`, plus the owner-assigned role for its measurements must equal `role`.
    /// Returns the measurements hash.
    pub fn require_role(&self, account: &AccountId, role: AgentRole) -> String {
        let agent = self.require_valid(account);
        let h = measurements_hash(&agent.measurements);
        require!(self.roles.get(&h).copied() == Some(role), ERR_ROLE);
        h
    }

    // ---- views ----

    pub fn get_agent(&self, account_id: &AccountId) -> Option<AgentView> {
        self.agents.get(account_id).map(|a| {
            let h = measurements_hash(&a.measurements);
            AgentView {
                account_id: account_id.clone(),
                measurements: a.measurements.clone(),
                measurements_hash: h.clone(),
                ppid: a.ppid.clone(),
                valid_until_ms: U64(a.valid_until_ms),
                role: self.roles.get(&h).copied(),
                valid: self.is_valid(account_id, a),
                session_pub: a.session_pub.clone(),
                session_expires_sec: U64(a.session_expires_sec),
            }
        })
    }

    pub fn get_approved(&self) -> ApprovedView {
        ApprovedView {
            requires_tee: self.requires_tee,
            attestation_expiration_time_ms: U64(self.attestation_expiration_time_ms),
            measurements: self
                .approved_measurements
                .iter()
                .map(|m| {
                    let h = measurements_hash(m);
                    ApprovedMeasurement {
                        measurements: m.clone(),
                        role: self.roles.get(&h).copied(),
                        measurements_hash: h,
                    }
                })
                .collect(),
            ppids: self.approved_ppids.iter().cloned().collect(),
            whitelisted_agents_for_local: if self.requires_tee {
                vec![]
            } else {
                self.whitelisted_agents_for_local.iter().cloned().collect()
            },
        }
    }
}
