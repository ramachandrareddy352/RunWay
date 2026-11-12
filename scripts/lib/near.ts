// near-api-js helpers for the testnet scripts. Keys live in near CLI's legacy keychain
// (~/.near-credentials/<network>/<account>.json); new accounts' keys are saved there too.
import { homedir } from "node:os";
import { join } from "node:path";
import { profiles, signingRpcUrls } from "@runway/config";
import { failover } from "@runway/sdk";
import { connect, KeyPair, keyStores, providers, type Account, type Near } from "near-api-js";

export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const near = (n: number) => (BigInt(Math.round(n * 1000)) * NEAR) / 1000n;

interface Outcome {
  transaction: { hash: string };
  status: unknown;
  receipts_outcome: { id: string; outcome: { status: unknown; logs: string[] } }[];
}

export interface Chain {
  near: Near;
  keyStore: keyStores.UnencryptedFileSystemKeyStore;
  networkId: string;
  nodeUrl: string;
  account(id: string): Promise<Account>;
  hasKey(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  newKey(id: string): Promise<KeyPair>;
}

/** NEAR_RPC_URL if set, else every testnet RPC in order: a request moves to the next one when an RPC
 * is unavailable (HTTP 429/5xx, as free RPCs answer shared CI and cloud IPs). */
export const testnetRpcs = (): string[] =>
  process.env.NEAR_RPC_URL ? [process.env.NEAR_RPC_URL] : signingRpcUrls(profiles.testnet);

export async function chainFor(
  networkId: string,
  rpcs: string | string[],
  keyDir = join(homedir(), ".near-credentials"),
): Promise<Chain> {
  const keyStore = new keyStores.UnencryptedFileSystemKeyStore(keyDir);
  const urls = [rpcs].flat();
  const nodeUrl = urls[0]!;
  const provider = failover(urls.map((url) => new providers.JsonRpcProvider({ url })));
  const n = await connect({ networkId, nodeUrl, keyStore, provider } as Parameters<typeof connect>[0]);
  return {
    near: n,
    keyStore,
    networkId,
    nodeUrl,
    account: (id) => n.account(id),
    hasKey: async (id) => (await keyStore.getKey(networkId, id)) !== null,
    async exists(id) {
      try {
        await (await n.account(id)).state();
        return true;
      } catch {
        return false;
      }
    },
    async newKey(id) {
      const kp = KeyPair.fromRandom("ed25519");
      await keyStore.setKey(networkId, id, kp);
      return kp;
    },
  };
}

/** Failure messages of the transaction and every receipt (near-api-js only throws for the top level). */
export function failures(o: Outcome): string[] {
  const out: string[] = [];
  const pick = (s: unknown) => {
    const f = (s as { Failure?: unknown })?.Failure;
    if (f) out.push(JSON.stringify(f));
  };
  pick(o.status);
  for (const r of o.receipts_outcome) pick(r.outcome.status);
  return out;
}

export function logs(o: Outcome): string[] {
  return o.receipts_outcome.flatMap((r) => r.outcome.logs);
}

export function returnValue<T>(o: Outcome): T | undefined {
  const s = o.status as { SuccessValue?: string };
  if (!s?.SuccessValue) return undefined;
  try {
    return JSON.parse(Buffer.from(s.SuccessValue, "base64").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

export interface CallResult<T> {
  hash: string;
  value?: T;
  failures: string[];
  logs: string[];
}

export async function call<T = unknown>(
  signer: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  o: { gas?: bigint; deposit?: bigint; allowFailure?: boolean } = {},
): Promise<CallResult<T>> {
  const outcome = (await signer.functionCall({
    contractId,
    methodName,
    args,
    gas: o.gas ?? 100n * TGAS,
    attachedDeposit: o.deposit ?? 0n,
  })) as unknown as Outcome;
  const r = {
    hash: outcome.transaction.hash,
    value: returnValue<T>(outcome),
    failures: failures(outcome),
    logs: logs(outcome),
  };
  if (r.failures.length > 0 && !o.allowFailure)
    throw new Error(
      `${contractId}.${methodName} failed (${r.hash}): ${r.failures.join(" | ").slice(0, 600)}`,
    );
  return r;
}

export const view = <T>(
  acc: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
) => acc.viewFunction({ contractId, methodName, args }) as Promise<T>;
