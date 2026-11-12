// Opt-in: the web app's data layer against the live testnet deployment and a running services/node.
//   RUNWAY_LIVE=1 pnpm --filter @runway/web exec vitest run test/live-testnet.test.ts
// Skipped by default (and in CI): it needs the network.
import { describe, expect, it } from "vitest";
import { payoutsFor } from "../lib/actions";
import { verifiedSession } from "../lib/agents";
import { credit, verified } from "../lib/chain";
import { DEPLOYMENT, UNDERWRITER_URL, GATEWAY_URL } from "../lib/env";

const live = !!process.env.RUNWAY_LIVE;

describe.skipIf(!live)("live testnet", () => {
  it("resolves the demo merchant over two agreeing RPCs", async () => {
    const m = await verified.credit.merchant("priya");
    expect(m?.merchant.settlement).toBe(`priya.${DEPLOYMENT.factory}`);
  }, 60_000);

  it("reads the vault", async () => {
    const v = await credit.vault();
    expect(BigInt(v.total_assets)).toBeGreaterThan(0n);
  }, 60_000);

  it("verifies both agents' session keys against the chain", async () => {
    const uw = await verifiedSession(UNDERWRITER_URL, "Underwriter", verified.credit.agent);
    expect(uw.agent.role).toBe("Underwriter");
    const gw = await verifiedSession(GATEWAY_URL, "InrGateway", verified.gateway.agent);
    expect(gw.agent.role).toBe("InrGateway");
  }, 60_000);

  it("lists rupee payouts", async () => {
    const e2e = process.env.RUNWAY_E2E_MERCHANT;
    if (!e2e) return;
    const ps = await payoutsFor(e2e);
    expect(ps.some((p) => p.status === "Paid")).toBe(true);
  }, 120_000);
});
