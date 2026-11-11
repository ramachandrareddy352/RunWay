// Entry point (testnet, Shade local mode until a TEE deployment is approved; Amendment A1).
// `process.env.NETWORK` is replaced at build time; on a mainnet build the mock branch below is dead
// code and the bundler drops MockInrProvider and its routes entirely (test E22).
import { serve } from "@hono/node-server";
import {
  bootShade,
  dstackKeySource,
  localKeySource,
  NonceCache,
  rpcReader,
  safeLogger,
  SessionKeys,
} from "@runway/agent-kit";
import { MultiSourceOracle } from "@runway/fx";
import type { Hono } from "hono";
import { endpointsFor } from "./endpoints.js";
import { readEnv } from "./env.js";
import { payoutTick } from "./payout.js";
import { retryPaid, type PayinDeps } from "./payin.js";
import { RazorpayProvider } from "./providers/razorpay.js";
import type { InrProvider } from "./providers/types.js";
import { createGatewayApp } from "./server.js";
import { GatewayStore } from "./store.js";

const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
const ep = endpointsFor(network);
const env = readEnv();
const log = safeLogger();

let provider: InrProvider;
let mountMock: ((app: Hono) => void) | undefined;
if (process.env.NETWORK !== "mainnet" && env.INR_PROVIDER === "mock") {
  const { MockInrProvider, mountMockRoutes } = await import("./mock-routes.js");
  if (!env.MOCK_WEBHOOK_SECRET) throw new Error("MOCK_WEBHOOK_SECRET is required for the mock provider");
  const mock = new MockInrProvider({ publicUrl: env.PUBLIC_URL, webhookSecret: env.MOCK_WEBHOOK_SECRET });
  provider = mock;
  mountMock = (app) => mountMockRoutes(app, mock);
} else {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
    throw new Error("Razorpay keys are required");
  provider = new RazorpayProvider({
    base: ep.razorpay,
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    accountNumber: env.RAZORPAYX_ACCOUNT_NUMBER,
  });
}

const sponsor =
  env.SPONSOR_ACCOUNT_ID && env.SPONSOR_PRIVATE_KEY
    ? { accountId: env.SPONSOR_ACCOUNT_ID, privateKey: env.SPONSOR_PRIVATE_KEY }
    : undefined;
const shade = await bootShade({
  network,
  agentContractId: ep.ids.inr,
  sponsor,
  derivationPath: env.AGENT_DERIVATION_PATH,
});
const inTee = process.env.TEE === "1";
const keys = inTee
  ? dstackKeySource()
  : localKeySource(env.AGENT_DERIVATION_PATH ?? "runway-local-inr-gateway-key");
const session = new SessionKeys(shade.signer);
await session.rotate();
session.start((e) => log.warn("session_rotate_failed", { code: (e as Error).name }));

const reader = rpcReader({ rpcs: ep.rpcs });
const oracle = new MultiSourceOracle(ep.fxSources());
const blobKey = await keys.appKey("runway/beneficiary/v1");
const payin: PayinDeps = {
  provider,
  store: new GatewayStore(env.DATABASE_PATH),
  oracle,
  reader,
  signer: shade.signer,
  ids: ep.ids,
  payerKey: await keys.appKey("runway/payer/v1"),
  log,
};
const app = createGatewayApp({
  network,
  payin,
  beneficiary: {
    session,
    provider,
    signer: shade.signer,
    rpc: reader.rpc,
    seenNonces: new NonceCache(),
    blobKey,
    log,
  },
  session,
  oracle,
  log,
  registered: shade.registered,
  mountMock,
});

let busy = false;
setInterval(() => {
  if (busy) return;
  busy = true;
  Promise.all([
    payoutTick({ provider, oracle, reader, signer: shade.signer, inr: ep.ids.inr, blobKey, log }),
    retryPaid(payin),
  ])
    .catch((e) => log.warn("worker_failed", { code: (e as Error).name }))
    .finally(() => (busy = false));
}, 10_000);

serve({ fetch: app.fetch, port: env.PORT });
log.info("inr_gateway_started", { network, provider: provider.name, agent: shade.signer.accountId() });
