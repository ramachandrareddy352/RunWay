// HARDCODED per network (design §8.1): RPCs, data-source URLs and contract IDs are part of the image,
// so they are covered by its measurements. Whoever runs an approved image can't point it at a fake
// RPC. Secrets come from env.ts; nothing here may.
//
// The sandbox is the exception: it is a throwaway local chain whose RPC URL and accounts change on
// every run, it is never measured, and `requires_tee = false` there.

import { deploymentFor, profiles, TESTNET_ROOT, type Network, type Profile } from "@runway/config";

export interface Endpoints {
  network: Network;
  profile: Profile;
  rpcs: string[];
  credit: string;
  factory: string;
  inr: string;
  /** The untrusted payment log (mainnet only: 1Click-verified revenue). */
  api?: string;
  oneclick: string;
  stripe: string;
  nearai: string;
}

const COMMON = {
  oneclick: "https://1click.chaindefuser.com",
  stripe: "https://api.stripe.com",
  nearai: "https://cloud-api.near.ai",
};

export function testnetEndpoints(): Endpoints {
  const d = deploymentFor(TESTNET_ROOT);
  return {
    network: "testnet",
    profile: profiles.testnet,
    rpcs: profiles.testnet.rpcUrls,
    credit: d.credit,
    factory: d.factory,
    inr: d.inr,
    ...COMMON,
  };
}

/** Sandbox only: the local chain's RPC and accounts, from the demo harness. */
export function sandboxEndpoints(s: {
  rpc: string;
  credit: string;
  factory: string;
  inr: string;
}): Endpoints {
  return { network: "sandbox", profile: profiles.sandbox, rpcs: [s.rpc], ...s, ...COMMON };
}

/** The image's network is fixed at build time (`NETWORK` build arg). Mainnet isn't built (Amendment A1). */
export function endpointsFor(network: Network): Endpoints {
  if (network === "testnet") return testnetEndpoints();
  if (network === "mainnet") throw new Error("mainnet images are not built (Amendment A1: testnet only)");
  throw new Error("sandbox endpoints come from the demo harness (sandboxEndpoints)");
}
