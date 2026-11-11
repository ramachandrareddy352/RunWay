// Test doubles: a fake NEAR JSON-RPC node (block, view_access_key, call_function), a capturing
// signer, and a merchant fixture. The real dual-RPC client, NEP-413 check and pipeline run on top.
import { policyJson, profiles, usdc } from "@runway/config";
import { base58Encode, fromBase64, fromUtf8, signNep413, toBase64, utf8, type Fetch } from "@runway/sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { NonceCache, underwriteMessage, UNDERWRITE_RECIPIENT } from "../src/auth.js";
import type { AgentSigner } from "@runway/agent-kit";
import { rpcReader } from "@runway/agent-kit";
import { sandboxEndpoints } from "../src/endpoints.js";
import { localKeySource } from "@runway/agent-kit";
import { safeLogger } from "@runway/agent-kit";
import type { UnderwriteDeps } from "../src/underwrite.js";

export type ViewFn = (
  contract: string,
  method: string,
  args: Record<string, unknown>,
  url: string,
) => unknown;

export interface FakeChain {
  height: number;
  timestampSec: number;
  /** account → full-access public keys */
  keys: Map<string, string[]>;
  view: ViewFn;
}

export function fakeRpc(chain: FakeChain): Fetch {
  return async (url, init) => {
    const req = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
    const ok = (result: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    });
    if (req.method === "block")
      return ok({
        header: {
          height: chain.height,
          timestamp_nanosec: String(BigInt(chain.timestampSec) * 1_000_000_000n),
        },
      });
    const p = req.params;
    if (p.request_type === "view_access_key") {
      const has = chain.keys.get(String(p.account_id))?.includes(String(p.public_key));
      return has
        ? ok({ nonce: 1, permission: "FullAccess", block_height: chain.height })
        : ok({ error: `access key ${String(p.public_key)} does not exist`, block_height: chain.height });
    }
    if (p.request_type === "call_function") {
      const args = JSON.parse(fromUtf8(fromBase64(String(p.args_base64)))) as Record<string, unknown>;
      const v = chain.view(String(p.account_id), String(p.method_name), args, url);
      return ok({
        result: Array.from(utf8(JSON.stringify(v ?? null))),
        logs: [],
        block_height: chain.height,
      });
    }
    throw new Error(`unexpected RPC ${req.method}`);
  };
}

/** A merchant key pair and its NEAR-format secret. */
export function nearKey(seedByte: number) {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seedByte) & 0xff);
  const pub = ed25519.getPublicKey(seed);
  return {
    secret: `ed25519:${base58Encode(new Uint8Array([...seed, ...pub]))}`,
    public: `ed25519:${base58Encode(pub)}`,
  };
}

export const PRIYA = "priya.test";
export const SETTLEMENT = "priya.pay.test";
export const CREDIT = "credit.test";
export const INR = "inr.test";

export interface Scenario {
  buckets?: number[];
  currentBucket?: number;
  repaid?: number;
  inrReceipts?: [string, unknown][];
  inrGateway?: string | null;
}

/** Views for priya with `buckets` (whole USDC) ending just before `currentBucket`. */
export function merchantViews(s: Scenario = {}): ViewFn {
  const current = s.currentBucket ?? 10;
  const amounts = s.buckets ?? [4_000, 4_000, 4_000, 4_000, 4_000, 4_000];
  const buckets = amounts.map((a, i) => ({
    bucket: String(current - amounts.length + i),
    inflow: String(usdc(a)),
  }));
  return (contract, method) => {
    if (contract === CREDIT && method === "get_merchant")
      return {
        merchant: {
          handle: "priya",
          payout: PRIYA,
          settlement: SETTLEMENT,
          payout_mode: "Usdc",
          frozen: false,
          active_loan: null,
        },
        record: { loans_repaid: s.repaid ?? 0, loans_defaulted: 0 },
        claimable: "0",
      };
    if (contract === CREDIT && method === "get_config")
      return { inr_gateway: s.inrGateway === undefined ? INR : s.inrGateway, time: { offer_ttl_sec: 600 } };
    if (contract === CREDIT && method === "get_policy") return policyJson(profiles.sandbox.policy);
    if (contract === SETTLEMENT && method === "get_state")
      return { current_bucket: String(current), bucket_sec: "300" };
    if (contract === SETTLEMENT && method === "get_buckets") return buckets;
    if (contract === INR && method === "get_payins_by_handle") return s.inrReceipts ?? [];
    throw new Error(`no view ${contract}.${method}`);
  };
}

export interface Captured {
  calls: { method: string; args: Record<string, unknown> }[];
}

export function capturingSigner(
  c: Captured,
  onCall?: (method: string, args: Record<string, unknown>) => unknown,
): AgentSigner {
  return {
    accountId: () => "agent.test",
    async call<T>(method: string, args: Record<string, unknown>) {
      c.calls.push({ method, args });
      return (onCall?.(method, args) ?? "7") as T;
    },
  };
}

export function deps(
  over: Partial<UnderwriteDeps> & { chain?: Partial<FakeChain>; scenario?: Scenario; logs?: string[] } = {},
) {
  const key = nearKey(1);
  const chain: FakeChain = {
    height: 1_000,
    timestampSec: 1_800_000_000,
    keys: new Map([[PRIYA, [key.public]]]),
    view: merchantViews(over.scenario),
    ...over.chain,
  };
  const captured: Captured = { calls: [] };
  const logs = over.logs ?? [];
  const d: UnderwriteDeps = {
    endpoints: sandboxEndpoints({ rpc: "http://rpc-a", credit: CREDIT, factory: "pay.test", inr: INR }),
    reader: rpcReader({ rpcs: ["http://rpc-a", "http://rpc-b"], fetch: fakeRpc(chain) }),
    signer: capturingSigner(captured),
    nonces: new NonceCache(),
    keys: localKeySource("test-seed-0123456789"),
    log: safeLogger((l) => logs.push(l)),
    sandboxFixtureAnchor: true,
    ...over,
  };
  return { d, key, chain, captured, logs };
}

export function signedRequest(secret: string, accountId = PRIYA, handle = "priya") {
  return signNep413(
    { message: underwriteMessage(handle), recipient: UNDERWRITE_RECIPIENT },
    accountId,
    secret,
  );
}

export const b64 = (s: string) => toBase64(utf8(s));
