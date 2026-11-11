// Beneficiary registration (BUILD_PLAN T4b.7, §9.9 POST /inr/beneficiary).
// The request is sealed to the gateway's on-chain session key and carries a NEP-413 signature by the
// account being registered. The UPI ID or bank details go to the provider only; on-chain there is
// just an encrypted blob with the provider's fund-account id and a masked label.
import { TGAS, type AgentSigner, type Logger, type SessionKeys } from "@runway/agent-kit";
import {
  openJson,
  verifyNep413,
  type RpcOptions,
  type Sealed,
  type SignedMessage,
  BENEFICIARY_CONTEXT,
  beneficiaryMessage,
  GATEWAY_RECIPIENT,
} from "@runway/sdk";
import { z } from "zod";
import { sealBlob } from "./blob.js";
import type { BeneficiaryDetails, InrProvider } from "./providers/types.js";

export { BENEFICIARY_CONTEXT, beneficiaryMessage, GATEWAY_RECIPIENT };

export const VPA = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER = /^\d{9,18}$/;

const Nep413 = z.object({
  accountId: z.string().max(64),
  publicKey: z.string().max(100),
  signature: z.string().max(200),
  message: z.string().max(300),
  nonce: z.string().max(64),
  recipient: z.string().max(64),
  callbackUrl: z.string().nullable().optional(),
});

const Plain = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("vpa"),
      nep413_auth: Nep413,
      account_id: z.string().max(64),
      name: z.string().min(2).max(100),
      vpa: z.string().regex(VPA),
    })
    .strict(),
  z
    .object({
      type: z.literal("bank_account"),
      nep413_auth: Nep413,
      account_id: z.string().max(64),
      name: z.string().min(2).max(100),
      ifsc: z.string().regex(IFSC),
      account_number: z.string().regex(ACCOUNT_NUMBER),
    })
    .strict(),
]);

export class BeneficiaryRejected extends Error {}

export interface BeneficiaryDeps {
  session: SessionKeys;
  provider: InrProvider;
  signer: AgentSigner;
  rpc: RpcOptions;
  seenNonces: { has(n: string): boolean; add(n: string): unknown };
  blobKey: Uint8Array;
  log: Logger;
}

export async function registerBeneficiary(
  sealed: Sealed,
  d: BeneficiaryDeps,
): Promise<{ ok: true; masked: string }> {
  const s = d.session.current();
  if (!s) throw new BeneficiaryRejected("no session key yet");
  let raw: unknown;
  try {
    raw = openJson<unknown>(sealed, s.keypair, BENEFICIARY_CONTEXT);
  } catch {
    throw new BeneficiaryRejected("cannot decrypt (stale session key?)");
  }
  const parsed = Plain.safeParse(raw);
  if (!parsed.success) throw new BeneficiaryRejected("invalid beneficiary details");
  const p = parsed.data;
  const auth = p.nep413_auth as SignedMessage;
  if (auth.accountId !== p.account_id)
    throw new BeneficiaryRejected("the signer must be the beneficiary account");
  if (auth.message !== beneficiaryMessage(p.account_id))
    throw new BeneficiaryRejected("signed message does not match");
  const v = await verifyNep413(auth, {
    expectedRecipient: GATEWAY_RECIPIENT,
    seenNonces: d.seenNonces,
    maxAgeMs: 5 * 60_000,
    rpc: d.rpc,
  });
  if (!v.ok) throw new BeneficiaryRejected(v.reason);

  const details: BeneficiaryDetails =
    p.type === "vpa"
      ? { type: "vpa", name: p.name, vpa: p.vpa }
      : { type: "bank_account", name: p.name, ifsc: p.ifsc, accountNumber: p.account_number };
  const fa = await d.provider.ensureBeneficiary(details);
  const blob = sealBlob(d.blobKey, p.account_id, {
    fund_account_id: fa.fundAccountId,
    masked: fa.masked,
    mode: p.type === "vpa" ? "UPI" : "IMPS",
  });
  await d.signer.call(
    "set_beneficiary_blob",
    { account_id: p.account_id, ciphertext_b64: blob },
    { gas: 30n * TGAS },
  );
  d.log.info("beneficiary_set", { kind: p.type });
  return { ok: true, masked: fa.masked };
}
