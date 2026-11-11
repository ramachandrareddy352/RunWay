// Refund address validation per chain family (BUILD_PLAN T2.2 step 3).
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58Decode } from "@runway/sdk";

const EVM = new Set([
  "eth",
  "base",
  "arb",
  "bsc",
  "pol",
  "op",
  "avax",
  "gnosis",
  "bera",
  "monad",
  "scroll",
  "xlayer",
  "plasma",
]);
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type Family = "evm" | "solana" | "near" | "tron" | "btc" | "other";

export function familyOf(blockchain: string): Family {
  if (EVM.has(blockchain)) return "evm";
  if (blockchain === "sol") return "solana";
  if (blockchain === "near") return "near";
  if (blockchain === "tron") return "tron";
  if (blockchain === "btc") return "btc";
  return "other";
}

/** EIP-55: all-lowercase or all-uppercase is accepted; mixed case must match the checksum. */
function evmOk(a: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const body = a.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = Array.from(keccak_256(new TextEncoder().encode(body.toLowerCase())), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return [...body].every((ch, i) => {
    if (/\d/.test(ch)) return true;
    const upper = parseInt(hash[i]!, 16) >= 8;
    return upper ? ch === ch.toUpperCase() : ch === ch.toLowerCase();
  });
}

export function validRefundAddress(blockchain: string, address: string): boolean {
  const a = address.trim();
  switch (familyOf(blockchain)) {
    case "evm":
      return evmOk(a);
    case "solana":
      try {
        return base58Decode(a).length === 32;
      } catch {
        return false;
      }
    case "near":
      return a.length >= 2 && a.length <= 64 && NEAR_ACCOUNT.test(a);
    case "tron":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    case "btc":
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    default:
      return a.length >= 8 && a.length <= 128 && !/\s/.test(a);
  }
}
