// Builds a running underwriter (testnet): signer, session key, NEAR AI client and the Hono app.
// Local mode signs with UNDERWRITER_AGENT_ACCOUNT_ID/PRIVATE_KEY (a whitelisted account, Shade local
// mode). Without them it boots ShadeClient, which is the path for a TEE deployment.
import {
  bootShade,
  dstackKeySource,
  keySigner,
  localKeySource,
  NonceCache,
  rpcReader,
  safeLogger,
  SessionKeys,
  withoutBlanks,
  type AgentSigner,
  type Logger,
} from "@runway/agent-kit";
import { MultiSourceOracle } from "@runway/fx";
import { indianExchangeSources } from "@runway/fx/sources";
import type { Hono } from "hono";
import { z } from "zod";
import { endpointsFor } from "./endpoints.js";
import { SecretsSchema } from "./env.js";
import { dcapQuoteVerifier, NearAi, nrasCheck } from "./nearai.js";
import { createUnderwriterApp } from "./server.js";

const Env = SecretsSchema.extend({
  UNDERWRITER_AGENT_ACCOUNT_ID: z.string().min(2).optional(),
  UNDERWRITER_AGENT_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  TEE: z.enum(["0", "1"]).default("0"),
});

export interface Underwriter {
  app: Hono;
  agent: string;
  stop(): void;
}

export async function createUnderwriter(
  env: NodeJS.ProcessEnv = process.env,
  log: Logger = safeLogger(),
): Promise<Underwriter> {
  const e = Env.parse(withoutBlanks(env));
  const ep = endpointsFor("testnet");
  let signer: AgentSigner;
  let registered: () => Promise<boolean>;
  if (e.UNDERWRITER_AGENT_ACCOUNT_ID && e.UNDERWRITER_AGENT_PRIVATE_KEY) {
    const k = await keySigner({
      networkId: "testnet",
      nodeUrl: ep.rpcs[0]!,
      accountId: e.UNDERWRITER_AGENT_ACCOUNT_ID,
      privateKey: e.UNDERWRITER_AGENT_PRIVATE_KEY,
      contractId: ep.credit,
    });
    signer = k;
    registered = () => k.registered();
  } else {
    const sponsor =
      e.SPONSOR_ACCOUNT_ID && e.SPONSOR_PRIVATE_KEY
        ? { accountId: e.SPONSOR_ACCOUNT_ID, privateKey: e.SPONSOR_PRIVATE_KEY }
        : undefined;
    const shade = await bootShade({
      network: "testnet",
      agentContractId: ep.credit,
      sponsor,
      derivationPath: e.AGENT_DERIVATION_PATH,
    });
    signer = shade.signer;
    registered = shade.registered;
  }
  if (!(await registered())) log.warn("agent_not_registered", { agent: signer.accountId() });

  const keys =
    e.TEE === "1"
      ? dstackKeySource()
      : localKeySource(e.AGENT_DERIVATION_PATH ?? "runway-local-underwriter-key-v1");
  const session = new SessionKeys(signer);
  await session.rotate();
  const stopRotation = session.start((err) =>
    log.warn("session_rotate_failed", { code: (err as Error).name }),
  );

  const nearai = e.NEARAI_API_KEY
    ? new NearAi({
        base: ep.nearai,
        apiKey: e.NEARAI_API_KEY,
        model: "z-ai/glm-5.3-flash",
        verify: { quotes: dcapQuoteVerifier(), nvidia: nrasCheck() },
        dailyCalls: e.NEARAI_DAILY_CALLS,
      })
    : undefined;

  const app = createUnderwriterApp({
    endpoints: ep,
    reader: rpcReader({ rpcs: ep.rpcs }),
    signer,
    nonces: new NonceCache(),
    keys,
    log,
    nearai,
    oracle: new MultiSourceOracle(indianExchangeSources()),
    session,
    registered,
  });
  log.info("underwriter_started", { network: ep.network, agent: signer.accountId() });
  return { app, agent: signer.accountId(), stop: stopRotation };
}
