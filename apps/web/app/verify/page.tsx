"use client";
// /verify (BUILD_PLAN T3.5): requires_tee, approved measurements and roles, PPIDs, local-mode
// whitelist, and each agent's registration with a live "session key matches chain" check.
import type { AgentRole, AgentView, ApprovedView } from "@runway/sdk";
import { Badge, Card, ErrorText } from "../../components/ui";
import { verifiedSession } from "../../lib/agents";
import { credit, gateway } from "../../lib/chain";
import { GATEWAY_URL, UNDERWRITER_URL } from "../../lib/env";
import { useAsync } from "../../lib/useAsync";

function Approved({ title, a }: { title: string; a: ApprovedView }) {
  return (
    <Card
      title={title}
      aside={a.requires_tee ? <Badge tone="good">requires TEE</Badge> : <Badge tone="warn">local mode</Badge>}
    >
      <div className="space-y-2 text-sm">
        {!a.requires_tee && (
          <p>
            Local mode (Amendment A1): agents are whitelisted accounts with mock measurements, so this shows
            the protocol, not hardware isolation. A TEE deployment uses a fresh contract with{" "}
            <code>requires_tee = true</code>.
          </p>
        )}
        <p className="font-medium">Approved images</p>
        <ul className="space-y-1">
          {a.measurements.map((m) => (
            <li key={m.measurements_hash} className="font-mono text-xs">
              {m.measurements_hash} → {m.role ?? "no role"}
            </li>
          ))}
        </ul>
        <p>
          PPIDs: {a.ppids.length} · whitelisted local agents:{" "}
          {a.whitelisted_agents_for_local.join(", ") || "none"} · attestation lifetime{" "}
          {Math.round(Number(a.attestation_expiration_time_ms) / 3_600_000)} h
        </p>
      </div>
    </Card>
  );
}

function AgentCard({
  name,
  url,
  role,
  getAgent,
}: {
  name: string;
  url: string;
  role: AgentRole;
  getAgent: (id: string) => Promise<AgentView | null>;
}) {
  const s = useAsync(() => verifiedSession(url, role, getAgent), [url]);
  return (
    <Card
      title={name}
      aside={
        s.data ? (
          <Badge tone="good">session key matches chain</Badge>
        ) : s.error ? (
          <Badge tone="bad">check failed</Badge>
        ) : null
      }
    >
      {s.data ? (
        <ul className="space-y-1 text-sm">
          <li>
            Account <span className="font-mono">{s.data.agent.account_id}</span>, role {s.data.agent.role}
          </li>
          <li>Valid until {new Date(Number(s.data.agent.valid_until_ms)).toISOString()}</li>
          <li className="break-all">
            Session key <span className="font-mono">{s.data.served.session_pub}</span>, expires{" "}
            {new Date(Number(s.data.agent.session_expires_sec) * 1000).toISOString()}
          </li>
        </ul>
      ) : (
        <ErrorText error={s.error} />
      )}
    </Card>
  );
}

export default function VerifyPage() {
  const c = useAsync(() => credit.approved(), []);
  const g = useAsync(() => gateway.approved(), []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Verify the agents</h1>
      {c.data && <Approved title="Credit contract (Underwriter)" a={c.data} />}
      {g.data && <Approved title="INR gateway contract (InrGateway)" a={g.data} />}
      <AgentCard name="Underwriter" url={UNDERWRITER_URL} role="Underwriter" getAgent={credit.agent} />
      <AgentCard name="INR gateway" url={GATEWAY_URL} role="InrGateway" getAgent={gateway.agent} />
      <ErrorText error={c.error ?? g.error} />
    </div>
  );
}
