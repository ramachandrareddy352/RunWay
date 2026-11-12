// Builds the API and starts its keeper loop (every 15 s): used by server.ts and by services/node.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deploymentFor, profiles, signingRpcUrls } from "@runway/config";
import { getStatus } from "@runway/sdk";
import type { Hono } from "hono";
import { z } from "zod";
import { createApp } from "./app.js";
import { nearChain } from "./chain.js";
import { Keeper } from "./keeper.js";
import { PaymentStore } from "./store.js";

export const ApiEnv = z.object({
  NEAR_NETWORK: z.enum(["sandbox", "testnet"]), // Amendment A1: never mainnet
  RUNWAY_ROOT: z.string().min(2),
  KEEPER_ACCOUNT_ID: z.string().min(2),
  KEEPER_PRIVATE_KEY: z.string().startsWith("ed25519:"),
  DATABASE_PATH: z.string().default("./data/runway.sqlite"),
  ONECLICK_API_KEY: z.string().optional(),
  NEAR_RPC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().default(8787),
});

export interface ApiRuntime {
  app: Hono;
  keeper: Keeper;
  stop(): void;
}

export async function createApiRuntime(
  env: NodeJS.ProcessEnv = process.env,
  log: { info(m: string): void; warn(m: string): void } = {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
  },
): Promise<ApiRuntime> {
  // Blank variables (`NAME=` in .env) count as unset.
  const e = ApiEnv.parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== "")),
  );
  const dep = deploymentFor(e.RUNWAY_ROOT);
  // The keeper's transactions go through the first available RPC (HTTP 429/5xx moves to the next).
  const nodeUrl = e.NEAR_RPC_URL ? [e.NEAR_RPC_URL] : signingRpcUrls(profiles[e.NEAR_NETWORK]);
  if (nodeUrl.length === 0) throw new Error("no RPC URL: set NEAR_RPC_URL");
  if (e.DATABASE_PATH !== ":memory:") mkdirSync(dirname(e.DATABASE_PATH), { recursive: true });
  const store = new PaymentStore(e.DATABASE_PATH);
  const chain = await nearChain({
    networkId: e.NEAR_NETWORK,
    nodeUrl,
    keeperId: e.KEEPER_ACCOUNT_ID,
    keeperKey: e.KEEPER_PRIVATE_KEY,
    credit: dep.credit,
    token: dep.token,
  });
  const keeper = new Keeper(
    store,
    chain,
    async (addr) => {
      const s = await getStatus(addr, undefined, { apiKey: e.ONECLICK_API_KEY });
      return { status: s.status, amountOut: s.swapDetails?.amountOut };
    },
    log,
  );
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    keeper.tick().finally(() => (running = false));
  }, 15_000);
  const app = createApp({ store, chain, network: e.NEAR_NETWORK });
  return { app, keeper, stop: () => clearInterval(timer) };
}
