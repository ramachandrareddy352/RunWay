// Browser-side check of an agent's session key before encrypting anything to it (BUILD_PLAN T3.2).
// The agent serves `{agent_account, session_pub, expires_sec}`; the chain must say the same thing:
// a registered, unexpired agent with the expected role, whose stored session key equals the served
// one and hasn't expired. Only then may a client encrypt to it.

import { decodeSessionPub } from "./seal.js";

export type AgentRole = "Underwriter" | "Risk" | "InrGateway";

/** `get_agent` JSON (runway_shared::agents::AgentView). */
export interface AgentView {
  account_id: string;
  measurements_hash: string;
  valid_until_ms: string;
  role: AgentRole | null;
  valid: boolean;
  session_pub: string | null;
  session_expires_sec: string;
  ppid?: unknown;
  measurements?: unknown;
}

export interface ServedSession {
  agent_account: string;
  session_pub: string;
  expires_sec: number;
}

export type SessionCheck =
  { ok: true; agent: AgentView; sessionPub: Uint8Array } | { ok: false; reason: string };

export async function checkSession(
  served: ServedSession,
  getAgent: (accountId: string) => Promise<AgentView | null>,
  o: { role: AgentRole; nowMs?: number },
): Promise<SessionCheck> {
  const now = o.nowMs ?? Date.now();
  let agent: AgentView | null;
  try {
    agent = await getAgent(served.agent_account);
  } catch (e) {
    return { ok: false, reason: `chain read failed: ${(e as Error).message}` };
  }
  if (!agent) return { ok: false, reason: "agent is not registered on-chain" };
  if (!agent.valid) return { ok: false, reason: "agent registration is not valid" };
  if (Number(agent.valid_until_ms) <= now) return { ok: false, reason: "agent attestation expired" };
  if (agent.role !== o.role)
    return { ok: false, reason: `agent role is ${agent.role ?? "none"}, not ${o.role}` };
  if (!agent.session_pub) return { ok: false, reason: "agent has no session key on-chain" };
  if (agent.session_pub !== served.session_pub)
    return { ok: false, reason: "served session key does not match the chain" };
  if (Number(agent.session_expires_sec) * 1000 <= now) return { ok: false, reason: "session key expired" };
  let sessionPub: Uint8Array;
  try {
    sessionPub = decodeSessionPub(agent.session_pub);
  } catch {
    return { ok: false, reason: "malformed session key" };
  }
  return { ok: true, agent, sessionPub };
}
