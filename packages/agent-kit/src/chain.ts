// The agent's two views of the chain:
//   Reader: dual-RPC reads pinned to one final block (design §8.4 step 2); any disagreement aborts.
//   AgentSigner: calls on the agent contract, signed by the agent account (ShadeClient in a TEE or
//   local mode; a plain key-backed account in the sandbox harness).
import { agreedHeight, viewAgreed, type RpcOptions } from "@runway/sdk";

export interface Snapshot {
  height: number;
  /** Timestamp of the pinned block, in seconds (chain time; the sandbox runs ahead of the wall clock). */
  timestampSec: number;
  view<T>(contract: string, method: string, args?: Record<string, unknown>): Promise<T>;
}

export interface Reader {
  rpc: RpcOptions;
  /** Pins every read in the returned snapshot to the same final block on every RPC. */
  snapshot(): Promise<Snapshot>;
}

export function rpcReader(rpc: RpcOptions): Reader {
  return {
    rpc,
    async snapshot() {
      const height = await agreedHeight(rpc);
      const at: RpcOptions = { ...rpc, blockId: height };
      const timestampSec = await blockTimestampSec(rpc, height);
      return {
        height,
        timestampSec,
        view: <T>(contract: string, method: string, args: Record<string, unknown> = {}) =>
          viewAgreed<T>(contract, method, args, at),
      };
    },
  };
}

async function blockTimestampSec(rpc: RpcOptions, height: number): Promise<number> {
  const f = (rpc.fetch ?? globalThis.fetch) as unknown as typeof fetch;
  const res = await f(rpc.rpcs[0]!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "runway", method: "block", params: { block_id: height } }),
  });
  const body = (await res.json()) as { result?: { header: { timestamp_nanosec: string } } };
  if (!body.result) throw new Error("block lookup failed");
  return Number(BigInt(body.result.header.timestamp_nanosec) / 1_000_000_000n);
}

export interface CallOptions {
  gas?: bigint;
  deposit?: bigint;
}

export interface AgentSigner {
  accountId(): string;
  /** A call on the agent contract (credit for the underwriter, inr for the gateway). */
  call<T>(method: string, args: Record<string, unknown>, opts?: CallOptions): Promise<T>;
}

export const TGAS = 10n ** 12n;
