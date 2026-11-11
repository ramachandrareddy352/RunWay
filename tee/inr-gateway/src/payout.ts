// Payout worker (design §9A.7/§9A.8 R2/R3/R5, BUILD_PLAN T4b.7).
// For each Pending request: no beneficiary → fail_payout("no_beneficiary"); else rate → start_payout
// (recorded on-chain BEFORE the provider call) → provider payout with idempotency key payout-<id> →
// complete_payout(sha256(utr)) or fail_payout(reason). Processing requests (a restart, or a payout
// still in flight) are re-sent with the same key; the provider de-duplicates (test E20).
import { sha256 } from "@noble/hashes/sha2.js";
import { errorCode, TGAS, type AgentSigner, type Logger, type Reader } from "@runway/agent-kit";
import { usdcToInr, type Oracle } from "@runway/fx";
import { base58Encode, utf8, type GatewayLimits, type PayoutRequest } from "@runway/sdk";
import { openBlob } from "./blob.js";
import { TERMINAL_PAYOUT, type InrProvider } from "./providers/types.js";

export interface PayoutDeps {
  provider: InrProvider;
  oracle: Oracle;
  reader: Reader;
  signer: AgentSigner;
  inr: string;
  /** K_app-derived blob key. */
  blobKey: Uint8Array;
  log: Logger;
}

export const idempotencyKey = (id: string) => `payout-${id}`;
/** `complete_payout(sha256(utr))` (BUILD_PLAN T4b.7). */
export const utrHash = (utr: string) => base58Encode(sha256(utf8(utr)));

export async function payoutTick(d: PayoutDeps): Promise<void> {
  const snap = await d.reader.snapshot();
  const [pending, limits] = await Promise.all([
    snap.view<PayoutRequest[]>(d.inr, "get_pending_payouts", { from: "0", limit: 50 }),
    snap.view<GatewayLimits>(d.inr, "get_limits"),
  ]);
  for (const p of pending) {
    try {
      await processPayout(p, limits, d, (account) =>
        snap.view<string | null>(d.inr, "get_beneficiary_blob", { account_id: account }),
      );
    } catch (e) {
      d.log.warn("payout_error", { payout_id: p.id, code: errorCode(e) });
    }
  }
}

async function processPayout(
  p: PayoutRequest,
  limits: GatewayLimits,
  d: PayoutDeps,
  blobOf: (account: string) => Promise<string | null>,
): Promise<void> {
  const call = (method: string, args: Record<string, unknown>) =>
    d.signer.call(method, args, { gas: 100n * TGAS });
  const blobB64 = await blobOf(p.beneficiary);
  if (!blobB64) {
    if (p.status === "Pending") {
      await call("fail_payout", { payout_id: p.id, reason: "no_beneficiary" });
      d.log.info("payout_failed", { payout_id: p.id, reason: "no_beneficiary" });
    }
    return;
  }
  const blob = openBlob(d.blobKey, p.beneficiary, blobB64);

  let paise: bigint;
  if (p.status === "Pending") {
    const rate = await d.oracle.read();
    if (rate.paused) return; // try again next tick
    paise = usdcToInr(BigInt(p.usdc), rate.ratePpu, limits.spread_bps);
    await call("start_payout", { payout_id: p.id, inr_paise: paise.toString(), rate_ppu: rate.ratePpu });
  } else if (p.status === "Processing" && p.inr_paise) {
    paise = BigInt(p.inr_paise);
  } else return;

  // Same key on every attempt: a crash between start_payout and here, or a retry, makes one payout.
  const created = await d.provider.createPayout({
    fundAccountId: blob.fund_account_id,
    amountPaise: paise,
    idempotencyKey: idempotencyKey(p.id),
    reference: idempotencyKey(p.id),
    mode: blob.mode,
  });
  const st = await d.provider.fetchPayout(created.payoutId);
  if (st.status === "processed") {
    if (!st.utr) return; // UTR not assigned yet
    await call("complete_payout", { payout_id: p.id, utr_hash: utrHash(st.utr) });
    d.log.info("payout_paid", { payout_id: p.id });
  } else if (TERMINAL_PAYOUT.includes(st.status)) {
    await call("fail_payout", { payout_id: p.id, reason: (st.failureReason ?? st.status).slice(0, 64) });
    d.log.info("payout_failed", { payout_id: p.id, reason: st.status });
  }
}
