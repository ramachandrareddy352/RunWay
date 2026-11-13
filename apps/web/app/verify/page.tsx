"use client";
// /verify (BUILD_PLAN T3.5): requires_tee, approved measurements and roles, PPIDs, local-mode
// whitelist, and each agent's registration with a live "session key matches chain" check.
import type { AgentRole, AgentView, ApprovedView } from "@runway/sdk";
import { Badge, Callout, Card, Container, ErrorText, PageHeader } from "../../components/ui";
import { verifiedSession } from "../../lib/agents";
import { credit, gateway, verified } from "../../lib/chain";
import { GATEWAY_URL, UNDERWRITER_URL } from "../../lib/env";
import { useAsync } from "../../lib/useAsync";

function Approved({ title, a, what }: { title: string; a: ApprovedView; what: string }) {
  return (
    <Card
      title={title}
      description={what}
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
        <p className="font-semibold">Approved images</p>
        <ul className="space-y-1">
          {a.measurements.map((m) => (
            <li key={m.measurements_hash} className="break-all rounded-lg bg-sand-50 p-2 font-mono text-xs">
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
  what,
}: {
  name: string;
  url: string;
  role: AgentRole;
  getAgent: (id: string) => Promise<AgentView | null>;
  what: string;
}) {
  const s = useAsync(() => verifiedSession(url, role, getAgent), [url]);
  return (
    <Card
      title={name}
      description={what}
      aside={
        s.data ? (
          <Badge tone="good">session key matches chain</Badge>
        ) : s.error ? (
          <Badge tone="bad">check failed</Badge>
        ) : (
          <Badge tone="warn">checking…</Badge>
        )
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
    <Container className="py-10">
      <PageHeader eyebrow="Verify" title="Verify the agents">
        Two agents do Runway&apos;s private work. This page checks, from the chain itself, which agent images
        are approved, which accounts may act, and that each running agent&apos;s session key is the one
        published on-chain. A green <strong>session key matches chain</strong> means your browser can safely
        encrypt to that agent.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        {c.data && (
          <Approved
            title="Credit contract (Underwriter)"
            a={c.data}
            what="Which agent images may sign loan offers, and with which role."
          />
        )}
        {g.data && (
          <Approved
            title="INR gateway contract (InrGateway)"
            a={g.data}
            what="Which agent images may record rupee receipts and pay rupee payouts."
          />
        )}
        <AgentCard
          name="Underwriter"
          url={UNDERWRITER_URL}
          role="Underwriter"
          getAgent={verified.credit.agent}
          what="Reads merchants' revenue privately and proposes offers."
        />
        <AgentCard
          name="INR gateway"
          url={GATEWAY_URL}
          role="InrGateway"
          getAgent={verified.gateway.agent}
          what="Converts rupees to USDC and back, and keeps payout details encrypted."
        />
      </div>
      <div className="mt-6">
        <Callout tone="info" title="What the check does">
          Your browser asks each agent for its current session key, then reads the agent&apos;s registration
          from two independent NEAR RPCs (they must agree) and compares. If an attacker ran a fake agent, its
          key wouldn&apos;t be on-chain and this would show “check failed”. If it says “checking…” for long,
          the free backend is waking up: reload in a minute.
        </Callout>
      </div>
      <ErrorText error={c.error ?? g.error} />
    </Container>
  );
}
