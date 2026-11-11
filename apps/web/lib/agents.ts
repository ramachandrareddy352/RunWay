// Browser side of the agent protocol: check the served session key against the chain BEFORE
// encrypting anything to it (BUILD_PLAN T3.2), then send sealed requests (§9.7, §9.9).
import {
  checkSession,
  fromBase64,
  newX25519Keypair,
  openJson,
  sealJson,
  type AgentRole,
  type AgentView,
  type Sealed,
  type ServedSession,
} from "@runway/sdk";

export interface VerifiedSession {
  served: ServedSession;
  agent: AgentView;
  sessionPub: Uint8Array;
}

export async function verifiedSession(
  baseUrl: string,
  role: AgentRole,
  getAgent: (id: string) => Promise<AgentView | null>,
  f: typeof fetch = fetch,
): Promise<VerifiedSession> {
  const res = await f(`${baseUrl}/session`);
  if (!res.ok) throw new Error(`agent unavailable (HTTP ${res.status})`);
  const served = (await res.json()) as ServedSession;
  const check = await checkSession(served, getAgent, { role });
  if (!check.ok) throw new Error(`session check failed: ${check.reason}`);
  return { served, agent: check.agent, sessionPub: check.sessionPub };
}

/** POSTs `body` sealed to the agent; returns the JSON reply and the key that opens its sealed part. */
export async function postSealed<T>(
  url: string,
  body: unknown,
  sessionPub: Uint8Array,
  context: string,
  f: typeof fetch = fetch,
): Promise<{ reply: T; open: <U>(s: Sealed, ctx: string) => U }> {
  const me = newX25519Keypair();
  const { sealed } = sealJson(body, sessionPub, context, me);
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sealed),
  });
  const reply = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
  return { reply, open: <U>(s: Sealed, ctx: string) => openJson<U>(s, me, ctx) };
}

export const b64ToBytes = fromBase64;
