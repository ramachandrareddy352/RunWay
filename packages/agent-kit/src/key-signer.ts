// Local-mode signer (Shade local mode: a whitelisted account with mock measurements). It signs agent
// calls with a key from the environment, so the agents run on any Node host. In a TEE, use
// `bootShade` instead: there the agent account must be the TEE-derived implicit account.
import { failover } from "@runway/sdk";
import { connect, KeyPair, keyStores, providers } from "near-api-js";
import type { AgentSigner, CallOptions } from "./chain.js";

type KeyPairString = Parameters<typeof KeyPair.fromString>[0];

interface Outcome {
  transaction: { hash: string };
  status: unknown;
  receipts_outcome: { outcome: { status: unknown } }[];
}

export interface KeySigner extends AgentSigner {
  /** True when the agent contract lists this account as a valid agent. */
  registered(): Promise<boolean>;
}

export async function keySigner(o: {
  networkId: "testnet" | "sandbox";
  /** One RPC, or several: a transaction moves to the next one when an RPC is unavailable (HTTP 429/5xx). */
  nodeUrl: string | string[];
  accountId: string;
  privateKey: string;
  contractId: string;
}): Promise<KeySigner> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(o.networkId, o.accountId, KeyPair.fromString(o.privateKey as KeyPairString));
  const near = await connect({
    networkId: o.networkId,
    nodeUrl: [o.nodeUrl].flat()[0],
    keyStore,
    provider: nearProvider(o.nodeUrl),
  } as Parameters<typeof connect>[0]);
  const account = await near.account(o.accountId);
  return {
    accountId: () => o.accountId,
    async call<T>(method: string, args: Record<string, unknown>, opts?: CallOptions): Promise<T> {
      const out = (await account.functionCall({
        contractId: o.contractId,
        methodName: method,
        args,
        gas: opts?.gas ?? 100n * 10n ** 12n,
        attachedDeposit: opts?.deposit ?? 0n,
      })) as unknown as Outcome;
      const failed = [out.status, ...out.receipts_outcome.map((r) => r.outcome.status)]
        .map((s) => (s as { Failure?: unknown })?.Failure)
        .filter(Boolean);
      if (failed.length > 0) throw new Error(`${method} failed: ${JSON.stringify(failed[0]).slice(0, 400)}`);
      const v = (out.status as { SuccessValue?: string }).SuccessValue;
      if (!v) return undefined as T;
      try {
        return JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;
      } catch {
        return undefined as T;
      }
    },
    async registered() {
      const a = (await account.viewFunction({
        contractId: o.contractId,
        methodName: "get_agent",
        args: { account_id: o.accountId },
      })) as { valid?: boolean } | null;
      return a?.valid === true;
    },
  };
}

/** A near-api-js provider over one or more RPCs (see `failover` in @runway/sdk). */
export function nearProvider(urls: string | string[]): providers.Provider {
  return failover([urls].flat().map((url) => new providers.JsonRpcProvider({ url })));
}
