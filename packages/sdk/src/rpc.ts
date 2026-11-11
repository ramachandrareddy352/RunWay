// Minimal NEAR JSON-RPC client with dual-RPC agreement (BUILD_PLAN T1.8).
// Reads that matter (merchant settlement account, agent registration, buckets) are made against two
// independent RPCs at the same final block, and must agree.

export class RpcDisagreement extends Error {
  constructor(
    readonly method: string,
    readonly results: unknown[],
  ) {
    super(`RPC providers disagree on ${method}`);
  }
}

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface RpcOptions {
  rpcs: string[];
  /** default true when more than one RPC is given */
  requireAgreement?: boolean;
  fetch?: Fetch;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; data?: unknown; cause?: unknown };
}

async function rpc<T>(url: string, method: string, params: unknown, f: Fetch): Promise<T> {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "runway", method, params }),
  });
  if (!res.ok) throw new Error(`${url} ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) throw new Error(`${url} ${method}: ${JSON.stringify(body.error)}`);
  const result = body.result as T & { error?: string };
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new Error(`${url} ${method}: ${String(result.error)}`);
  }
  return body.result as T;
}

const fetchImpl = (o: RpcOptions): Fetch => o.fetch ?? (globalThis.fetch as unknown as Fetch);

async function finalHeight(url: string, f: Fetch): Promise<number> {
  const b = await rpc<{ header: { height: number } }>(url, "block", { finality: "final" }, f);
  return b.header.height;
}

/** Runs `query` on every RPC at the lowest common final block and requires identical results. */
export async function queryAgreed<T>(params: Record<string, unknown>, o: RpcOptions): Promise<T> {
  const f = fetchImpl(o);
  if (o.rpcs.length === 0) throw new Error("no RPC configured");
  const agree = o.requireAgreement ?? o.rpcs.length > 1;
  if (!agree) return rpc<T>(o.rpcs[0]!, "query", { finality: "final", ...params }, f);
  const heights = await Promise.all(o.rpcs.map((u) => finalHeight(u, f)));
  const block_id = Math.min(...heights);
  const results = await Promise.all(
    o.rpcs.map((u) =>
      rpc<T & { block_height?: number; block_hash?: string }>(u, "query", { block_id, ...params }, f),
    ),
  );
  const strip = (r: unknown) => {
    const { block_height: _h, block_hash: _b, ...rest } = r as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const first = strip(results[0]);
  if (!results.every((r) => strip(r) === first))
    throw new RpcDisagreement(String(params.request_type), results);
  return results[0] as T;
}

/** View call (call_function) with dual-RPC agreement. */
export async function viewAgreed<T>(
  contract: string,
  method: string,
  args: unknown,
  o: RpcOptions,
): Promise<T> {
  const r = await queryAgreed<{ result: number[] }>(
    {
      request_type: "call_function",
      account_id: contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64"),
    },
    o,
  );
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
}

export interface AccessKeyView {
  nonce: number;
  permission:
    | "FullAccess"
    | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
}

export async function viewAccessKey(
  accountId: string,
  publicKey: string,
  o: RpcOptions,
): Promise<AccessKeyView> {
  return queryAgreed<AccessKeyView>(
    { request_type: "view_access_key", account_id: accountId, public_key: publicKey },
    o,
  );
}
