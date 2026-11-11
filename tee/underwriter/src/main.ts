// Entry point for the testnet image (local mode until a TEE deployment is approved, Amendment A1).
// `NETWORK` is fixed at build time; only secrets come from the environment.
import { serve } from "@hono/node-server";
import {
  bootShade,
  dstackKeySource,
  localKeySource,
  rpcReader,
  safeLogger,
  SessionKeys,
} from "@runway/agent-kit";
import { MultiSourceOracle } from "@runway/fx";
import { indianExchangeSources } from "@runway/fx/sources";
import { NonceCache } from "./auth.js";
import { endpointsFor } from "./endpoints.js";
import { readSecrets } from "./env.js";
import { dcapQuoteVerifier, NearAi, nrasCheck } from "./nearai.js";
import { createUnderwriterApp } from "./server.js";

const NETWORK = "testnet" as const;
const ep = endpointsFor(NETWORK);
const secrets = readSecrets();
const log = safeLogger();

const sponsor =
  secrets.SPONSOR_ACCOUNT_ID && secrets.SPONSOR_PRIVATE_KEY
    ? { accountId: secrets.SPONSOR_ACCOUNT_ID, privateKey: secrets.SPONSOR_PRIVATE_KEY }
    : undefined;
const shade = await bootShade({
  network: NETWORK,
  agentContractId: ep.credit,
  sponsor,
  derivationPath: secrets.AGENT_DERIVATION_PATH,
});
const inTee = process.env.DSTACK_SIMULATOR_ENDPOINT !== undefined || process.env.TEE === "1";
const keys = inTee
  ? dstackKeySource()
  : localKeySource(secrets.AGENT_DERIVATION_PATH ?? "runway-local-underwriter-key");
const session = new SessionKeys(shade.signer);
await session.rotate();
session.start((e) => log.warn("session_rotate_failed", { code: (e as Error).name }));

const nearai = secrets.NEARAI_API_KEY
  ? new NearAi({
      base: ep.nearai,
      apiKey: secrets.NEARAI_API_KEY,
      model: "z-ai/glm-5.3-flash",
      verify: { quotes: dcapQuoteVerifier(), nvidia: nrasCheck() },
      dailyCalls: secrets.NEARAI_DAILY_CALLS,
    })
  : undefined;

const app = createUnderwriterApp({
  endpoints: ep,
  reader: rpcReader({ rpcs: ep.rpcs }),
  signer: shade.signer,
  nonces: new NonceCache(),
  keys,
  log,
  nearai,
  oracle: new MultiSourceOracle(indianExchangeSources()),
  session,
  registered: shade.registered,
});
serve({ fetch: app.fetch, port: secrets.PORT });
log.info("underwriter_started", { network: ep.network, agent: shade.signer.accountId() });
