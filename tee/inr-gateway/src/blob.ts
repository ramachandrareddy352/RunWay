// Beneficiary blob (BUILD_PLAN T4b.7, test E21): the provider's fund-account id and a masked label,
// encrypted with a key derived from K_app (XChaCha20-Poly1305). The account id is bound as AAD, so a
// blob copied to another account doesn't decrypt. Only ciphertext goes on-chain.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { concatBytes, fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from "@runway/sdk";

export interface BeneficiaryBlob {
  fund_account_id: string;
  masked: string;
  mode: "UPI" | "IMPS";
}

const aad = (accountId: string) => utf8(`runway-beneficiary-v1|${accountId}`);

export function sealBlob(key: Uint8Array, accountId: string, b: BeneficiaryBlob): string {
  if (key.length !== 32) throw new Error("blob key must be 32 bytes");
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce, aad(accountId)).encrypt(utf8(JSON.stringify(b)));
  return toBase64(concatBytes(nonce, ct));
}

export function openBlob(key: Uint8Array, accountId: string, b64: string): BeneficiaryBlob {
  const raw = fromBase64(b64);
  if (raw.length < 24 + 16) throw new Error("blob too short");
  const pt = xchacha20poly1305(key, raw.slice(0, 24), aad(accountId)).decrypt(raw.slice(24));
  return JSON.parse(fromUtf8(pt)) as BeneficiaryBlob;
}
