// Stripe identity anchor (design §8.4 step 5, BUILD_PLAN T4.1).
// The merchant's restricted key is used once, in memory: GET /v1/account and the balance transactions
// in the revenue window. `anchor_hash = HMAC(K_app, "stripe:" + account_id)` makes one Stripe account
// anchor one handle (the contract rejects reuse, C8). Net USD per bucket feeds `corr` only.
import type { Network } from "@runway/config";
import { median } from "@runway/scoring";
import { z } from "zod";
import { hmacB58 } from "@runway/agent-kit";

const KEY = /^rk_(test|live)_[A-Za-z0-9]{10,}$/;
const MAX_PAGES = 20;

const Account = z.object({ id: z.string().regex(/^acct_[A-Za-z0-9]+$/) });
const BalanceTxns = z.object({
  data: z.array(
    z.object({ id: z.string(), net: z.number().int(), currency: z.string(), created: z.number().int() }),
  ),
  has_more: z.boolean(),
});

export interface StripeEvidence {
  anchorHash: string;
  /** Median net USD per complete bucket, micro-USDC. */
  medianPerBucket: bigint;
  testMode: boolean;
  /** Human-readable notes (ignored currencies, test-mode label). */
  notes: string[];
}

export class StripeKeyRejected extends Error {}

/** E10: test keys only on sandbox/testnet; live keys are accepted on testnet, never required. */
export function checkStripeKey(key: string, network: Network): { testMode: boolean } {
  const m = KEY.exec(key);
  if (!m) throw new StripeKeyRejected("not a Stripe restricted key (rk_test_… or rk_live_…)");
  const testMode = m[1] === "test";
  if (testMode && network === "mainnet")
    throw new StripeKeyRejected("test-mode keys are not accepted on mainnet");
  return { testMode };
}

export async function stripeAnchor(
  key: string,
  o: {
    network: Network;
    base: string;
    kApp: Uint8Array;
    windowStartSec: number;
    bucketSec: number;
    currentBucket: bigint;
    fetch?: typeof fetch;
  },
): Promise<StripeEvidence> {
  const { testMode } = checkStripeKey(key, o.network);
  const f = o.fetch ?? fetch;
  const get = async (path: string): Promise<unknown> => {
    const res = await f(`${o.base}${path}`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`stripe ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };

  const account = Account.parse(await get("/v1/account"));
  const perBucket = new Map<bigint, bigint>();
  const notes: string[] = testMode ? ["Stripe test mode, not real KYC"] : [];
  const ignored = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ "created[gte]": String(o.windowStartSec), limit: "100" });
    if (after) q.set("starting_after", after);
    const r = BalanceTxns.parse(await get(`/v1/balance_transactions?${q}`));
    for (const t of r.data) {
      if (t.currency.toLowerCase() !== "usd") {
        ignored.add(t.currency.toUpperCase());
        continue;
      }
      const bucket = BigInt(Math.floor(t.created / o.bucketSec));
      if (bucket >= o.currentBucket) continue;
      // cents × 10,000 = micro-USDC
      perBucket.set(bucket, (perBucket.get(bucket) ?? 0n) + BigInt(t.net) * 10_000n);
    }
    if (!r.has_more || r.data.length === 0) break;
    after = r.data[r.data.length - 1]!.id;
  }
  if (ignored.size > 0) notes.push(`non-USD balance transactions ignored: ${[...ignored].sort().join(", ")}`);
  const values = [...perBucket.values()].map((v) => (v < 0n ? 0n : v));
  return {
    anchorHash: hmacB58(o.kApp, `stripe:${account.id}`),
    medianPerBucket: median(values),
    testMode,
    notes,
  };
}
