// Razorpay identity anchor (design §9A.9, BUILD_PLAN T4b.8; SP15).
// The merchant's OWN Razorpay account is evidence (anchor + corr), not routed revenue. With a key the
// merchant supplies (test mode on testnet), read their settlements. The account id comes from the
// settlement rows' merchant scope; with OAuth (`read_only`) it would come from the token response.
// `anchor_hash = HMAC(K_app, "razorpay:" + account_id)`. Amounts are paise → USDC via @runway/fx.
import type { Network } from "@runway/config";
import { inrToUsdc, type Oracle } from "@runway/fx";
import { median } from "@runway/scoring";
import { toBase64, utf8 } from "@runway/sdk";
import { z } from "zod";
import { hmacB58 } from "@runway/agent-kit";

const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{6,}$/;

const Settlements = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      amount: z.number().int(),
      status: z.string(),
      created_at: z.number().int(),
    }),
  ),
});

export interface RazorpayAnchorInput {
  keyId: string;
  keySecret: string;
  /** The merchant's Razorpay account id (`acc_…`), shown in their dashboard. */
  accountId: string;
}

export interface RazorpayEvidence {
  anchorHash: string;
  medianPerBucket: bigint;
  testMode: boolean;
  notes: string[];
}

export async function razorpayAnchor(
  i: RazorpayAnchorInput,
  o: {
    network: Network;
    base: string;
    kApp: Uint8Array;
    oracle: Oracle;
    spreadBps: number;
    windowStartSec: number;
    bucketSec: number;
    currentBucket: bigint;
    fetch?: typeof fetch;
  },
): Promise<RazorpayEvidence> {
  const m = KEY_ID.exec(i.keyId);
  if (!m) throw new Error("not a Razorpay key id");
  const testMode = m[1] === "test";
  if (testMode && o.network === "mainnet") throw new Error("test-mode keys are not accepted on mainnet");
  if (!/^acc_[A-Za-z0-9]{6,}$/.test(i.accountId)) throw new Error("not a Razorpay account id");
  const reading = await o.oracle.read();
  if (reading.paused || reading.ratePpu <= 0) throw new Error("FX oracle paused");
  const f = o.fetch ?? fetch;
  const auth = `Basic ${toBase64(utf8(`${i.keyId}:${i.keySecret}`))}`;
  const q = new URLSearchParams({ from: String(o.windowStartSec), count: "100" });
  const res = await f(`${o.base}/v1/settlements?${q}`, { headers: { authorization: auth } });
  if (!res.ok) throw new Error(`razorpay settlements: HTTP ${res.status}`);
  const rows = Settlements.parse(await res.json()).items.filter((s) => s.status === "processed");
  const perBucket = new Map<bigint, bigint>();
  for (const s of rows) {
    const bucket = BigInt(Math.floor(s.created_at / o.bucketSec));
    if (bucket >= o.currentBucket) continue;
    const usdc = inrToUsdc(BigInt(s.amount), reading.ratePpu, o.spreadBps);
    perBucket.set(bucket, (perBucket.get(bucket) ?? 0n) + usdc);
  }
  return {
    anchorHash: hmacB58(o.kApp, `razorpay:${i.accountId}`),
    medianPerBucket: median([...perBucket.values()]),
    testMode,
    notes: testMode ? ["Razorpay test mode, not real KYC"] : [],
  };
}
