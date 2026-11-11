// Inputs commitment (design §8.4 step 7): sha256(canonical_json(inputs) || salt32), base58.
// The merchant receives {inputs, salt} sealed to them and can recompute it (test E6, /audit).
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Encode, concatBytes, fromBase64, randomBytes, toBase64, utf8 } from "@runway/sdk";

/** JSON with sorted object keys, bigints as decimal strings, and no undefined fields. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Map) return norm(Object.fromEntries(v));
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, norm(o[k])]),
      );
    }
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in inputs");
    return v;
  };
  return JSON.stringify(norm(value));
}

export function commitment(inputs: unknown, salt: Uint8Array): string {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  return base58Encode(sha256(concatBytes(utf8(canonicalJson(inputs)), salt)));
}

export function newSalt(): Uint8Array {
  return randomBytes(32);
}

/** What the merchant can check: the on-chain commitment from the sealed {inputs, salt}. */
export function verifyCommitment(onChain: string, inputs: unknown, saltB64: string): boolean {
  try {
    return commitment(inputs, fromBase64(saltB64)) === onChain;
  } catch {
    return false;
  }
}

export const saltToB64 = toBase64;
