// Runs the real agent code (tee/underwriter, tee/inr-gateway, services/api) against the local sandbox.
// Only the transport differs from a deployment: agents sign with sandbox accounts instead of
// ShadeClient, and reads use the sandbox's single RPC at optimistic finality (SPIKES SP2).
import {
  localKeySource,
  NonceCache,
  rpcReader,
  safeLogger,
  SessionKeys,
  TGAS,
  type AgentSigner,
  type Reader,
} from "@runway/agent-kit";
import { createApp, Keeper, PaymentStore, type Chain } from "@runway/api";
import { FixedOracle } from "@runway/fx";
import {
  beneficiaryMessage,
  BENEFICIARY_CONTEXT,
  createGatewayApp,
  GATEWAY_RECIPIENT,
  GatewayStore,
  payoutTick,
  type PayinDeps,
  type PayoutDeps,
} from "@runway/inr-gateway";
import { MockInrProvider, mountMockRoutes } from "@runway/inr-gateway/mock";
import {
  checkSession,
  newX25519Keypair,
  openJson,
  sealJson,
  signNep413,
  type AgentView,
  type ServedSession,
} from "@runway/sdk";
import {
  createUnderwriterApp,
  sandboxEndpoints,
  underwriteMessage,
  UNDERWRITE_CONTEXT,
  UNDERWRITE_RECIPIENT,
  UNDERWRITE_RESPONSE_CONTEXT,
  verifyCommitment,
} from "@runway/underwriter";
import type { NearAccount } from "near-workspaces";
import type { Hono } from "hono";
import { check, json, mint, ok, settle, type Stack } from "./sandbox.js";

export const rpcUrl = (s: Stack): string =>
  (s.worker.provider as unknown as { connection: { url: string } }).connection.url;

export const sandboxReader = (s: Stack): Reader => rpcReader({ rpcs: [rpcUrl(s)], finality: "optimistic" });

/** An agent signer backed by a sandbox account (ShadeClient's role in a deployment). */
export function accountSigner(acc: NearAccount, contract: string): AgentSigner {
  return {
    accountId: () => acc.accountId,
    async call<T>(method: string, args: Record<string, unknown>, opts?: { gas?: bigint; deposit?: bigint }) {
      const r = await acc.callRaw(contract, method, args, {
        gas: opts?.gas ?? 100n * TGAS,
        attachedDeposit: opts?.deposit ?? 0n,
      });
      if (r.failed || r.receiptFailureMessages.length > 0)
        throw new Error(`${method}: ${r.receiptFailureMessages.join(" | ") || r.summary()}`);
      try {
        return r.parseResult<T>();
      } catch {
        return undefined as T;
      }
    },
  };
}

export const secretKeyOf = async (a: NearAccount): Promise<string> => {
  const k = await a.getKey();
  if (!k) throw new Error(`no key for ${a.accountId}`);
  return k.toString();
};

// ---------- underwriter ----------

export interface Underwriter {
  app: Hono;
  session: SessionKeys;
}

export async function startUnderwriter(s: Stack): Promise<Underwriter> {
  const signer = accountSigner(s.agent, s.credit.accountId);
  const session = new SessionKeys(signer);
  await session.rotate();
  const app = createUnderwriterApp({
    endpoints: sandboxEndpoints({
      rpc: rpcUrl(s),
      credit: s.credit.accountId,
      factory: s.factory.accountId,
      inr: `inr.${s.root.accountId}`,
    }),
    reader: sandboxReader(s),
    signer,
    nonces: new NonceCache(),
    keys: localKeySource("runway-sandbox-demo-app-key"),
    log: safeLogger(() => {}),
    sandboxFixtureAnchor: true,
    session,
    registered: async () => true,
  });
  return { app, session };
}

async function servedSession(app: Hono): Promise<ServedSession> {
  const res = await app.request("/session");
  check(res.ok, `GET /session: ${res.status}`);
  return (await res.json()) as ServedSession;
}

export interface OfferReply {
  decision: "offer" | "decline";
  offer_id?: string;
  reasons: string[];
  terms?: { grade: string; limit: string; fee_bps: number; repay_bps: number };
}

/**
 * What the merchant's browser does on /merchant/capital: check the session key against the chain,
 * sign NEP-413, seal the request to the agent, then open the sealed reply and recompute the
 * commitment the agent put on-chain.
 */
export async function requestOffer(
  s: Stack,
  u: Underwriter,
  handle: string,
  merchant: NearAccount,
): Promise<OfferReply> {
  const served = await servedSession(u.app);
  const getAgent = (id: string) => s.credit.view<AgentView | null>("get_agent", { account_id: id });
  const sc = await checkSession(served, getAgent, { role: "Underwriter" });
  check(sc.ok, `session check: ${sc.ok ? "" : sc.reason}`);
  const nep413 = signNep413(
    { message: underwriteMessage(handle), recipient: UNDERWRITE_RECIPIENT },
    merchant.accountId,
    await secretKeyOf(merchant),
  );
  const me = newX25519Keypair();
  const { sealed } = sealJson({ handle, nep413 }, sc.sessionPub, UNDERWRITE_CONTEXT, me);
  const res = await u.app.request("/underwrite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sealed),
  });
  const body = (await res.json()) as OfferReply & { sealed?: Parameters<typeof openJson>[0]; error?: string };
  check(res.ok, `POST /underwrite: ${res.status} ${json(body)}`);
  if (body.decision === "offer") {
    const opened = openJson<{ inputs: unknown; salt: string; commitment: string }>(
      body.sealed!,
      me,
      UNDERWRITE_RESPONSE_CONTEXT,
    );
    const offer = await s.credit.view<{ inputs_commitment: string }>("get_offer", {
      offer_id: body.offer_id,
    });
    check(
      offer.inputs_commitment === opened.commitment &&
        verifyCommitment(offer.inputs_commitment, opened.inputs, opened.salt),
      "the sealed {inputs, salt} reproduce the on-chain commitment",
    );
  }
  return body;
}

// ---------- API (payment log + keeper) ----------

export function apiChain(s: Stack): Chain {
  const txId = (r: { result: { transaction_outcome: { id: string } } }) => r.result.transaction_outcome.id;
  return {
    async settlementOf(handle) {
      const m = await s.credit.view<{ merchant: { settlement: string } } | null>("get_merchant", { handle });
      return m?.merchant.settlement;
    },
    settle: async (settlement) => txId(await settle(s, settlement)),
    async activeLoanIds() {
      return (await s.credit.view<{ id: string }[]>("get_active_loans", {})).map((l) => l.id);
    },
    checkLoan: async (loanId) =>
      txId(
        ok(
          await s.keeper.callRaw(s.credit, "check_loan", { loan_id: loanId }, { gas: 50n * TGAS }),
          "check_loan",
        ),
      ),
    async mint(to, amount) {
      await mint(s, to, amount);
      return "sandbox-mint";
    },
  };
}

export function startApi(s: Stack) {
  const store = new PaymentStore();
  const chain = apiChain(s);
  const app = createApp({ store, chain, network: "sandbox" });
  const keeper = new Keeper(
    store,
    chain,
    async () => {
      throw new Error("no 1Click on the sandbox");
    },
    { info: () => {}, warn: (m) => console.warn(`  keeper: ${m}`) },
  );
  return { app, keeper, store };
}

// ---------- INR gateway ----------

export interface Gateway {
  app: Hono;
  provider: MockInrProvider;
  payin: PayinDeps;
  payout: PayoutDeps;
  session: SessionKeys;
}

export async function startGateway(s: Stack, inr: NearAccount, agent: NearAccount): Promise<Gateway> {
  const signer = accountSigner(agent, inr.accountId);
  const reader = sandboxReader(s);
  const keys = localKeySource("runway-sandbox-demo-gateway-key");
  const blobKey = await keys.appKey("runway/beneficiary/v1");
  const provider = new MockInrProvider({
    publicUrl: "http://gateway.sandbox",
    webhookSecret: "sandbox-demo-mock-webhook-secret",
  });
  const oracle = new FixedOracle(8_500); // ₹85.00 (sandbox profile, spread 0)
  const log = safeLogger(() => {});
  const ids = { inr: inr.accountId, credit: s.credit.accountId, factory: s.factory.accountId };
  const payin: PayinDeps = {
    provider,
    store: new GatewayStore(),
    oracle,
    reader,
    signer,
    ids,
    payerKey: await keys.appKey("runway/payer/v1"),
    log,
  };
  const session = new SessionKeys(signer);
  await session.rotate();
  const app = createGatewayApp({
    network: "sandbox",
    payin,
    beneficiary: { session, provider, signer, rpc: reader.rpc, seenNonces: new NonceCache(), blobKey, log },
    session,
    oracle,
    log,
    registered: async () => true,
    mountMock: (a) => mountMockRoutes(a, provider),
  });
  return {
    app,
    provider,
    payin,
    payout: { provider, oracle, reader, signer, inr: inr.accountId, blobKey, log },
    session,
  };
}

/** POST /inr/collect, then press "Simulate success" on the SIMULATED UPI page. */
export async function simulatedUpi(
  g: Gateway,
  body: Record<string, string>,
): Promise<{ collectId: string; status: string; usdc: bigint }> {
  const res = await g.app.request("/inr/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const c = (await res.json()) as {
    collect_id: string;
    mock_url?: string;
    error?: string;
    usdc_estimate: string;
    simulated: boolean;
  };
  check(res.status === 201 && c.simulated, `collect: ${res.status} ${json(c)}`);
  const pay = await g.app.request(`/mock/upi/${c.collect_id}/success`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  check(pay.ok, `simulate: ${pay.status}`);
  const st = (await (await g.app.request(`/inr/collect/${c.collect_id}`)).json()) as {
    status: string;
    reason?: string;
  };
  return {
    collectId: c.collect_id,
    status: st.reason ? `${st.status} (${st.reason})` : st.status,
    usdc: BigInt(c.usdc_estimate),
  };
}

/** POST /inr/beneficiary as the account's browser would: session check, NEP-413, sealed details. */
export async function registerUpi(
  s: Stack,
  g: Gateway,
  inr: NearAccount,
  who: NearAccount,
  vpa: string,
): Promise<string> {
  const served = await servedSession(g.app);
  const sc = await checkSession(served, (id) => inr.view<AgentView | null>("get_agent", { account_id: id }), {
    role: "InrGateway",
  });
  check(sc.ok, `gateway session check: ${sc.ok ? "" : sc.reason}`);
  const auth = signNep413(
    { message: beneficiaryMessage(who.accountId), recipient: GATEWAY_RECIPIENT },
    who.accountId,
    await secretKeyOf(who),
  );
  const { sealed } = sealJson(
    { type: "vpa", nep413_auth: auth, account_id: who.accountId, name: who.accountId.split(".")[0]!, vpa },
    sc.sessionPub,
    BENEFICIARY_CONTEXT,
  );
  const res = await g.app.request("/inr/beneficiary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sealed),
  });
  const r = (await res.json()) as { ok?: boolean; masked?: string; error?: string };
  check(res.ok && r.ok, `beneficiary: ${res.status} ${json(r)}`);
  return r.masked!;
}

export const runPayouts = (g: Gateway) => payoutTick(g.payout);
