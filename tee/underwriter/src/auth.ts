// Merchant authentication (design §8.4 step 1, BUILD_PLAN T3.3):
//   NEP-413 signature, recipient "runway-underwriter", message bound to the handle, nonce fresh
//   within 5 minutes and single use, the key is a FullAccess key of the account on BOTH RPCs, and the
//   account is the merchant's on-chain payout account.
import { NonceCache } from "@runway/agent-kit";
import { verifyNep413, type RpcOptions, type SignedMessage } from "@runway/sdk";

export { NonceCache };

export const UNDERWRITE_RECIPIENT = "runway-underwriter";
export const NONCE_MAX_AGE_MS = 5 * 60_000;

/** The exact message a merchant signs to ask for an offer. */
export const underwriteMessage = (handle: string): string => JSON.stringify({ action: "underwrite", handle });

export type AuthResult = { ok: true } | { ok: false; reason: string };

export async function authenticate(
  signed: SignedMessage,
  handle: string,
  payout: string,
  o: { rpc: RpcOptions; seen: NonceCache; now?: number; recipient?: string; message?: string },
): Promise<AuthResult> {
  if (signed.message !== (o.message ?? underwriteMessage(handle)))
    return { ok: false, reason: "signed message does not match this request" };
  if (signed.accountId !== payout)
    return { ok: false, reason: "signer is not the merchant's payout account" };
  return verifyNep413(signed, {
    expectedRecipient: o.recipient ?? UNDERWRITE_RECIPIENT,
    seenNonces: o.seen,
    maxAgeMs: NONCE_MAX_AGE_MS,
    now: o.now,
    rpc: o.rpc,
  });
}
