// Entry point: `pnpm --filter @runway/api dev` with the variables from `.env` (see .env.example).
import { serve } from "@hono/node-server";
import { deploymentFor, profiles } from "@runway/config";
import { getStatus } from "@runway/sdk";
import { z } from "zod";
import { createApp } from "./app.js";
import { nearChain } from "./chain.js";
import { Keeper } from "./keeper.js";
import { PaymentStore } from "./store.js";

const env = z
  .object({
    NEAR_NETWORK: z.enum(["sandbox", "testnet"]), // Amendment A1: never mainnet
    RUNWAY_ROOT: z.string().min(2),
    KEEPER_ACCOUNT_ID: z.string().min(2),
    KEEPER_PRIVATE_KEY: z.string().startsWith("ed25519:"),
    DATABASE_PATH: z.string().default("./data/runway.sqlite"),
    ONECLICK_API_KEY: z.string().optional(),
    NEAR_RPC_URL: z.string().url().optional(),
    PORT: z.coerce.number().int().default(8787),
  })
  .parse(process.env);

const dep = deploymentFor(env.RUNWAY_ROOT);
const nodeUrl = env.NEAR_RPC_URL ?? profiles[env.NEAR_NETWORK].rpcUrls[0];
if (!nodeUrl) throw new Error("no RPC URL: set NEAR_RPC_URL");

const store = new PaymentStore(env.DATABASE_PATH);
const chain = await nearChain({
  networkId: env.NEAR_NETWORK,
  nodeUrl,
  keeperId: env.KEEPER_ACCOUNT_ID,
  keeperKey: env.KEEPER_PRIVATE_KEY,
  credit: dep.credit,
  token: dep.token,
});
const keeper = new Keeper(
  store,
  chain,
  async (addr) => {
    const s = await getStatus(addr, undefined, { apiKey: env.ONECLICK_API_KEY });
    return { status: s.status, amountOut: s.swapDetails?.amountOut };
  },
  { info: (m) => console.log(m), warn: (m) => console.warn(m) },
);

let running = false;
setInterval(() => {
  if (running) return;
  running = true;
  keeper.tick().finally(() => (running = false));
}, 15_000);

serve({ fetch: createApp({ store, chain, network: env.NEAR_NETWORK }).fetch, port: env.PORT });
console.log(`runway api on :${env.PORT} (${env.NEAR_NETWORK}, credit ${dep.credit})`);
