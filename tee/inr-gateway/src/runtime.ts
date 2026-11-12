// Builds a running INR gateway (testnet): provider, signer, session key, store, oracle, the Hono app
// and the 10 s worker (payouts + retries of paid-but-unrecorded collects).
// `process.env.NETWORK` is replaced at build time; on a mainnet build the mock branch is dead code
// and the bundler drops MockInrProvider and its routes entirely (test E22).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  bootShade,
  dstackKeySource,
  keySigner,
  localKeySource,
  NonceCache,
  retry,
  rpcReader,
  safeLogger,
  SessionKeys,
  withoutBlanks,
  type AgentSigner,
  type Logger,
} from "@runway/agent-kit";
import { MultiSourceOracle } from "@runway/fx";
import type { Hono } from "hono";
import { z } from "zod";
import { endpointsFor } from "./endpoints.js";
import { GatewayEnv } from "./env.js";
import { payoutTick } from "./payout.js";
import { retryPaid, type PayinDeps } from "./payin.js";
import { RazorpayProvider } from "./providers/razorpay.js";
import type { InrProvider } from "./providers/types.js";
import { createGatewayApp } from "./server.js";
import { GatewayStore } from "./store.js";

const Env = GatewayEnv.extend({
  GATEWAY_AGENT_ACCOUNT_ID: z.string().min(2).optional(),
  GATEWAY_AGENT_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  TEE: z.enum(["0", "1"]).default("0"),
  /** The payments API (its keeper settles delivered UPI sales). */
  API_URL: z.string().url().optional(),
});

export interface Gateway {
  app: Hono;
  agent: string;
  provider: string;
  stop(): void;
}

/** `basePath` is where the app is mounted (e.g. "/gw" in services/node); the mock pages link under it. */
export async function createGateway(
  env: NodeJS.ProcessEnv = process.env,
  o: { basePath?: string; log?: Logger } = {},
): Promise<Gateway> {
  const e = Env.parse(withoutBlanks(env));
  const log = o.log ?? safeLogger();
  const basePath = o.basePath ?? "";
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const ep = endpointsFor(network);

  let provider: InrProvider;
  let mountMock: ((app: Hono) => void) | undefined;
  if (process.env.NETWORK !== "mainnet" && e.INR_PROVIDER === "mock") {
    const { MockInrProvider, mountMockRoutes } = await import("./mock-routes.js");
    if (!e.MOCK_WEBHOOK_SECRET) throw new Error("MOCK_WEBHOOK_SECRET is required for the mock provider");
    const mock = new MockInrProvider({
      publicUrl: `${e.PUBLIC_URL}${basePath}`,
      webhookSecret: e.MOCK_WEBHOOK_SECRET,
    });
    provider = mock;
    mountMock = (app) => mountMockRoutes(app, mock, basePath);
  } else {
    if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET || !e.RAZORPAY_WEBHOOK_SECRET)
      throw new Error("Razorpay keys are required");
    provider = new RazorpayProvider({
      base: ep.razorpay,
      keyId: e.RAZORPAY_KEY_ID,
      keySecret: e.RAZORPAY_KEY_SECRET,
      webhookSecret: e.RAZORPAY_WEBHOOK_SECRET,
      accountNumber: e.RAZORPAYX_ACCOUNT_NUMBER,
    });
  }

  let signer: AgentSigner;
  let registered: () => Promise<boolean>;
  if (e.GATEWAY_AGENT_ACCOUNT_ID && e.GATEWAY_AGENT_PRIVATE_KEY) {
    const k = await keySigner({
      networkId: "testnet",
      nodeUrl: ep.signingRpcs ?? ep.rpcs,
      accountId: e.GATEWAY_AGENT_ACCOUNT_ID,
      privateKey: e.GATEWAY_AGENT_PRIVATE_KEY,
      contractId: ep.ids.inr,
    });
    signer = k;
    registered = () => k.registered();
  } else {
    const sponsor =
      e.SPONSOR_ACCOUNT_ID && e.SPONSOR_PRIVATE_KEY
        ? { accountId: e.SPONSOR_ACCOUNT_ID, privateKey: e.SPONSOR_PRIVATE_KEY }
        : undefined;
    const shade = await bootShade({
      network,
      agentContractId: ep.ids.inr,
      sponsor,
      derivationPath: e.AGENT_DERIVATION_PATH,
    });
    signer = shade.signer;
    registered = shade.registered;
  }
  // One failed RPC request at boot must not crash the service: these steps retry with backoff.
  const onRetry = (source: string) => (err: unknown, count: number) =>
    log.warn("startup_retry", {
      source,
      count,
      code: (err as Error).name,
      status:
        typeof (err as { cause?: unknown }).cause === "number" ? (err as { cause: number }).cause : undefined,
    });
  if (!(await retry(registered, { onRetry: onRetry("check_registration") })))
    log.warn("agent_not_registered", { agent: signer.accountId() });

  const keys =
    e.TEE === "1"
      ? dstackKeySource()
      : localKeySource(e.AGENT_DERIVATION_PATH ?? "runway-local-inr-gateway-key-v1");
  const session = new SessionKeys(signer);
  await retry(() => session.rotate(), { onRetry: onRetry("first_session_key") });
  const stopRotation = session.start((err) =>
    log.warn("session_rotate_failed", { code: (err as Error).name }),
  );

  const reader = rpcReader({ rpcs: ep.rpcs });
  const oracle = new MultiSourceOracle(ep.fxSources());
  const blobKey = await keys.appKey("runway/beneficiary/v1");
  if (e.DATABASE_PATH !== ":memory:") mkdirSync(dirname(e.DATABASE_PATH), { recursive: true });
  const payin: PayinDeps = {
    provider,
    store: new GatewayStore(e.DATABASE_PATH),
    oracle,
    reader,
    signer,
    ids: ep.ids,
    payerKey: await keys.appKey("runway/payer/v1"),
    log,
    // A delivered UPI sale is new inflow on the merchant's settlement account: tell the API, whose
    // keeper calls the permissionless settle() so the payment splits like a crypto one.
    onDelivered: e.API_URL
      ? async (c) => {
          if (c.kind.type !== "merchant_sale" || !c.paymentRefHash) return;
          const res = await fetch(`${e.API_URL}/payments/upi`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle: c.kind.handle, paymentRefHash: c.paymentRefHash }),
          });
          if (!res.ok) throw new Error(`API HTTP ${res.status}`);
        }
      : undefined,
  };
  const app = createGatewayApp({
    network,
    payin,
    beneficiary: { session, provider, signer, rpc: reader.rpc, seenNonces: new NonceCache(), blobKey, log },
    session,
    oracle,
    log,
    registered,
    mountMock,
  });

  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    Promise.all([
      payoutTick({ provider, oracle, reader, signer, inr: ep.ids.inr, blobKey, log }),
      retryPaid(payin),
    ])
      .catch((err) => log.warn("worker_failed", { code: (err as Error).name }))
      .finally(() => (busy = false));
  }, 10_000);

  log.info("inr_gateway_started", { network, provider: provider.name, agent: signer.accountId() });
  return {
    app,
    agent: signer.accountId(),
    provider: provider.name,
    stop: () => {
      clearInterval(timer);
      stopRotation();
    },
  };
}
