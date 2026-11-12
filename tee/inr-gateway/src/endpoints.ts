// HARDCODED per network (design §9A.7): provider base, FX sources, NEAR RPCs, contract ids. Secrets
// come from env.ts only. The sandbox values come from the demo harness (never measured).
import { deploymentFor, profiles, signingRpcUrls, TESTNET_ROOT, type Network } from "@runway/config";
import type { RateSource } from "@runway/fx";
import { indianExchangeSources } from "@runway/fx/sources";
import type { GatewayIds } from "./payin.js";

export interface GatewayEndpoints {
  network: Network;
  /** Reads that gate an action must agree on all of these. */
  rpcs: string[];
  /** RPCs the agent's transactions may go through (default `rpcs`). */
  signingRpcs?: string[];
  ids: GatewayIds;
  razorpay: string;
  fxSources: () => RateSource[];
}

export function testnetEndpoints(): GatewayEndpoints {
  const d = deploymentFor(TESTNET_ROOT);
  return {
    network: "testnet",
    rpcs: profiles.testnet.rpcUrls,
    signingRpcs: signingRpcUrls(profiles.testnet),
    ids: { inr: d.inr, credit: d.credit, factory: d.factory },
    razorpay: "https://api.razorpay.com",
    fxSources: () => indianExchangeSources(),
  };
}

export function endpointsFor(network: Network): GatewayEndpoints {
  if (network === "testnet") return testnetEndpoints();
  if (network === "mainnet") throw new Error("mainnet images are not built (Amendment A1: testnet only)");
  throw new Error("sandbox endpoints come from the demo harness");
}
