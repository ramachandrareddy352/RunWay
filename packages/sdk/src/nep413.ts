// NEP-413 signed-message verification (design §8.4 step 1, BUILD_PLAN T1.8 / SD1–SD2).
// hash = sha256(borsh(u32 2^31+413) || borsh({message, nonce[32], recipient, callbackUrl?}))
// The signature must verify under `publicKey`, AND that key must be a FullAccess key of `accountId`
// on every configured RPC — otherwise anyone could "sign as priya.near" with an unrelated key.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Decode, base58Encode } from "./base58.js";
import { fromBase64, randomBytes, toBase64 } from "./bytes.js";
import { viewAccessKey, type RpcOptions } from "./rpc.js";

export const NEP413_TAG = 2 ** 31 + 413;

export interface SignedMessage {
  accountId: string;
  /** "ed25519:<base58>" */
  publicKey: string;
  /** base64 */
  signature: string;
  message: string;
  /** 32 bytes, base64 */
  nonce: string;
  recipient: string;
  callbackUrl?: string | null;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  return concat(u32(bytes.length), bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function nep413Hash(m: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}): Uint8Array {
  if (m.nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const callback =
    m.callbackUrl === undefined || m.callbackUrl === null
      ? Uint8Array.of(0)
      : concat(Uint8Array.of(1), borshString(m.callbackUrl));
  return sha256(concat(u32(NEP413_TAG), borshString(m.message), m.nonce, borshString(m.recipient), callback));
}

export function parseEd25519PublicKey(pk: string): Uint8Array {
  if (!pk.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  const raw = base58Decode(pk.slice("ed25519:".length));
  if (raw.length !== 32) throw new Error("bad ed25519 public key length");
  return raw;
}

/** Cryptographic check only (signature over the NEP-413 payload). */
export function verifySignature(s: SignedMessage): boolean {
  try {
    const hash = nep413Hash({
      message: s.message,
      nonce: fromBase64(s.nonce),
      recipient: s.recipient,
      callbackUrl: s.callbackUrl ?? null,
    });
    return ed25519.verify(fromBase64(s.signature), hash, parseEd25519PublicKey(s.publicKey));
  } catch {
    return false;
  }
}

export interface VerifyOptions {
  expectedRecipient: string;
  /** Rejects reused nonces (single use). */
  seenNonces: { has(nonce: string): boolean; add(nonce: string): unknown };
  /** Optional freshness: the nonce's first 8 bytes are a big-endian unix-ms timestamp. */
  maxAgeMs?: number;
  now?: number;
  rpc: RpcOptions;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Full check: signature, recipient, single-use nonce, freshness, FullAccess key of the account. */
export async function verifyNep413(s: SignedMessage, o: VerifyOptions): Promise<VerifyResult> {
  if (s.recipient !== o.expectedRecipient) return { ok: false, reason: "wrong recipient" };
  if (o.seenNonces.has(s.nonce)) return { ok: false, reason: "nonce reused" };
  if (!verifySignature(s)) return { ok: false, reason: "bad signature" };
  if (o.maxAgeMs !== undefined) {
    const nonce = fromBase64(s.nonce);
    if (nonce.length !== 32) return { ok: false, reason: "bad nonce" };
    const ts = Number(new DataView(nonce.buffer, nonce.byteOffset, 8).getBigUint64(0, false));
    if (Math.abs((o.now ?? Date.now()) - ts) > o.maxAgeMs) return { ok: false, reason: "stale nonce" };
  }
  try {
    const key = await viewAccessKey(s.accountId, s.publicKey, o.rpc);
    if (key.permission !== "FullAccess")
      return { ok: false, reason: "key is not a FullAccess key of the account" };
  } catch (e) {
    return { ok: false, reason: `key lookup failed: ${(e as Error).message}` };
  }
  o.seenNonces.add(s.nonce);
  return { ok: true };
}

/** 32-byte nonce whose first 8 bytes are the big-endian unix-ms time (checked by `maxAgeMs`). */
export function freshNonce(nowMs = Date.now()): Uint8Array {
  const n = randomBytes(32);
  new DataView(n.buffer).setBigUint64(0, BigInt(nowMs), false);
  return n;
}

/**
 * Signs a NEP-413 message with a NEAR `ed25519:<base58>` secret key (64 bytes: seed ‖ public key).
 * Wallets do this in the browser; the sandbox demo and tests use it with sandbox keys.
 */
export function signNep413(
  m: { message: string; recipient: string; nonce?: Uint8Array; callbackUrl?: string | null },
  accountId: string,
  secretKey: string,
): SignedMessage {
  if (!secretKey.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  const raw = base58Decode(secretKey.slice("ed25519:".length));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("bad ed25519 secret key length");
  const seed = raw.slice(0, 32);
  const nonce = m.nonce ?? freshNonce();
  const hash = nep413Hash({ message: m.message, nonce, recipient: m.recipient, callbackUrl: m.callbackUrl });
  const pub = ed25519.getPublicKey(seed);
  return {
    accountId,
    publicKey: `ed25519:${base58Encode(pub)}`,
    signature: toBase64(ed25519.sign(hash, seed)),
    message: m.message,
    nonce: toBase64(nonce),
    recipient: m.recipient,
    callbackUrl: m.callbackUrl ?? null,
  };
}
