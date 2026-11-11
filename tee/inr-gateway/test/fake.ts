// In-memory stand-in for inr-gateway + the credit views the agent reads. It mirrors the contract's
// rules that matter to the agent: the replay guard, the float, the payout state machine and the
// ₹ amount check in start_payout.
import { safeLogger, type AgentSigner, type Reader } from "@runway/agent-kit";
import { FixedOracle, inrToUsdc, usdcToInr } from "@runway/fx";
import type { GatewayLimits, PayinReceipt, PayoutRequest } from "@runway/sdk";
import { GatewayStore } from "../src/store.js";
import type { PayinDeps } from "../src/payin.js";
import { MockInrProvider } from "../src/providers/mock.js";

export const IDS = { inr: "inr.test", credit: "credit.test", factory: "pay.test" };
export const USDC = 1_000_000n;

export class FakeGateway {
  free = 1_000n * USDC;
  pending = 0n;
  paused = false;
  limits: GatewayLimits = {
    spread_bps: 0,
    min_rate_ppu: 7_000,
    max_rate_ppu: 13_000,
    max_payin_paise: "10000000",
    daily_payin_paise: "100000000",
    max_payout_usdc: String(2_000n * USDC),
  };
  receipts = new Map<string, PayinReceipt>();
  payouts = new Map<string, PayoutRequest>();
  blobs = new Map<string, string>();
  merchants = new Set(["priya"]);
  shareHolders = new Set(["investor.test"]);
  calls: { method: string; args: Record<string, unknown> }[] = [];
  /** Throw once from this method (simulates a crash or RPC failure). */
  failNext?: string;

  view(contract: string, method: string, args: Record<string, unknown>): unknown {
    if (contract === IDS.credit) {
      if (method === "get_merchant")
        return this.merchants.has(String(args.handle)) ? { merchant: { handle: args.handle } } : null;
      if (method === "storage_balance_of")
        return this.shareHolders.has(String(args.account_id)) ? { total: "1", available: "0" } : null;
      if (method === "get_loan") return args.loan_id === "12" ? { status: "Active" } : null;
    }
    if (contract === IDS.inr) {
      if (method === "get_config") return { paused_payins: this.paused };
      if (method === "get_limits") return this.limits;
      if (method === "get_float")
        return {
          free: String(this.free),
          payout_pending: String(this.pending),
          refunds_total: "0",
          daily_payin_day: 0,
          daily_payin_paise: "0",
        };
      if (method === "get_receipt") return this.receipts.get(String(args.payment_ref_hash)) ?? null;
      if (method === "get_pending_payouts")
        return [...this.payouts.values()].filter((p) => p.status === "Pending" || p.status === "Processing");
      if (method === "get_beneficiary_blob") return this.blobs.get(String(args.account_id)) ?? null;
    }
    throw new Error(`no view ${contract}.${method}`);
  }

  call(method: string, args: Record<string, unknown>): unknown {
    this.calls.push({ method, args });
    if (this.failNext === method) {
      this.failNext = undefined;
      throw new Error("network error (simulated crash)");
    }
    if (method === "record_payin") {
      const hash = String(args.payment_ref_hash);
      if (this.receipts.has(hash)) throw new Error("Smart contract panicked: ERR_PAYIN_REPLAY");
      const usdc = inrToUsdc(BigInt(String(args.inr_paise)), Number(args.rate_ppu), this.limits.spread_bps);
      if (usdc > this.free) throw new Error("Smart contract panicked: ERR_FLOAT");
      const kind = args.kind as PayinReceipt["kind"];
      const ok = kind.type !== "merchant_sale" || this.merchants.has(kind.handle);
      if (ok) this.free -= usdc;
      this.receipts.set(hash, {
        kind,
        inr_paise: String(args.inr_paise),
        rate_ppu: Number(args.rate_ppu),
        spread_bps: 0,
        usdc: String(usdc),
        delivered: ok ? String(usdc) : "0",
        payer_ref_hash: (args.payer_ref_hash as string | null) ?? null,
        at_sec: 1,
        status: ok ? "Delivered" : "Failed",
      });
      return undefined;
    }
    const p = this.payouts.get(String(args.payout_id));
    if (method === "start_payout") {
      if (!p || p.status !== "Pending") throw new Error("ERR_PAYOUT_STATE");
      const expected = usdcToInr(BigInt(p.usdc), Number(args.rate_ppu), 0);
      if (String(expected) !== String(args.inr_paise)) throw new Error("ERR_AMOUNT_MISMATCH");
      Object.assign(p, {
        status: "Processing",
        inr_paise: String(args.inr_paise),
        rate_ppu: Number(args.rate_ppu),
      });
      return undefined;
    }
    if (method === "complete_payout") {
      if (!p || p.status !== "Processing") throw new Error("ERR_PAYOUT_STATE");
      Object.assign(p, { status: "Paid", utr_hash: args.utr_hash });
      this.pending -= BigInt(p.usdc);
      this.free += BigInt(p.usdc);
      return undefined;
    }
    if (method === "fail_payout") {
      if (!p || (p.status !== "Pending" && p.status !== "Processing")) throw new Error("ERR_PAYOUT_STATE");
      Object.assign(p, { status: "Failed", failure_reason: args.reason });
      this.pending -= BigInt(p.usdc);
      return undefined;
    }
    if (method === "set_session_key") return undefined;
    if (method === "set_beneficiary_blob") {
      this.blobs.set(String(args.account_id), String(args.ciphertext_b64));
      return undefined;
    }
    throw new Error(`no method ${method}`);
  }

  addPayout(id: string, beneficiary: string, whole: bigint): void {
    this.payouts.set(id, {
      id,
      kind: "merchant_share",
      beneficiary,
      reference: "priya",
      usdc: String(whole * USDC),
      inr_paise: null,
      rate_ppu: null,
      utr_hash: null,
      failure_reason: null,
      created_sec: 1,
      status: "Pending",
    });
    this.pending += whole * USDC;
  }

  reader(): Reader {
    return {
      rpc: { rpcs: ["http://fake"] },
      snapshot: async () => ({
        height: 1,
        timestampSec: 1,
        view: async <T>(c: string, m: string, a: Record<string, unknown> = {}) => this.view(c, m, a) as T,
      }),
    };
  }

  signer(): AgentSigner {
    return {
      accountId: () => "gwagent.test",
      call: async <T>(m: string, a: Record<string, unknown>) => this.call(m, a) as T,
    };
  }
}

export const MOCK_SECRET = "mock-webhook-secret-0123456789";

export function payinDeps(g = new FakeGateway(), logs: string[] = []) {
  const provider = new MockInrProvider({ publicUrl: "http://gw.test", webhookSecret: MOCK_SECRET });
  const d: PayinDeps = {
    provider,
    store: new GatewayStore(),
    oracle: new FixedOracle(8_500),
    reader: g.reader(),
    signer: g.signer(),
    ids: IDS,
    payerKey: new Uint8Array(32).fill(7),
    log: safeLogger((l) => logs.push(l)),
  };
  return { g, d, provider, logs };
}
