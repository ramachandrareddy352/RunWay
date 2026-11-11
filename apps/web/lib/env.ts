// Public configuration (NEXT_PUBLIC_* only; BUILD_PLAN §10.2). Testnet by default (Amendment A1).
import { deploymentFor, profiles, TESTNET_ROOT } from "@runway/config";

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "sandbox";
export const ROOT = process.env.NEXT_PUBLIC_RUNWAY_ROOT ?? TESTNET_ROOT;
export const DEPLOYMENT = deploymentFor(ROOT);
export const RPCS = process.env.NEXT_PUBLIC_RPC_URLS
  ? process.env.NEXT_PUBLIC_RPC_URLS.split(",")
  : profiles.testnet.rpcUrls;
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const UNDERWRITER_URL = process.env.NEXT_PUBLIC_UNDERWRITER_URL ?? "http://localhost:8790";
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8791";
export const EXPLORER = "https://testnet.nearblocks.io";
export const PROFILE = profiles.testnet;
export const SIMULATED = NETWORK !== ("mainnet" as string);
