// Sealed messages between the browser and an agent (BUILD_PLAN T3.2/T3.3, §9.7).
// The sender makes a fresh X25519 key, derives a key with the recipient's public key via HKDF-SHA256,
// and encrypts with XChaCha20-Poly1305. The context string is both HKDF info and AAD, so a ciphertext
// made for one endpoint can't be replayed into another.
//
// Wire format (all base64): { client_pub: <sender's ephemeral X25519 key>, nonce: <24 bytes>, ciphertext }

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Decode, base58Encode } from "./base58.js";
import { concatBytes, fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from "./bytes.js";

export interface Sealed {
  client_pub: string;
  nonce: string;
  ciphertext: string;
}

export interface X25519Keypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Upper bound on any sealed request (BUILD_PLAN T3.3: reject anything over 10 MB). */
export const MAX_SEALED_BYTES = 10 * 1024 * 1024;

export const newX25519Keypair = (): X25519Keypair => x25519.keygen();

/** On-chain session keys are base58 (`set_session_key(pubkey_b58)`). */
export const encodeSessionPub = (pub: Uint8Array): string => base58Encode(pub);
export function decodeSessionPub(b58: string): Uint8Array {
  const raw = base58Decode(b58);
  if (raw.length !== 32) throw new Error("session key must be 32 bytes");
  return raw;
}

function deriveKey(shared: Uint8Array, senderPub: Uint8Array, recipientPub: Uint8Array, context: string) {
  return hkdf(sha256, shared, concatBytes(senderPub, recipientPub), utf8(`runway-seal-v1|${context}`), 32);
}

/** Encrypts `plaintext` to `recipientPub`. Returns the sealed message and the sender's keypair,
 *  so the caller can open a reply sealed back to `client_pub`. */
export function seal(
  plaintext: Uint8Array,
  recipientPub: Uint8Array,
  context: string,
  sender: X25519Keypair = newX25519Keypair(),
): { sealed: Sealed; sender: X25519Keypair } {
  const shared = x25519.getSharedSecret(sender.secretKey, recipientPub);
  const key = deriveKey(shared, sender.publicKey, recipientPub, context);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce, utf8(context)).encrypt(plaintext);
  shared.fill(0);
  key.fill(0);
  return {
    sealed: {
      client_pub: toBase64(sender.publicKey),
      nonce: toBase64(nonce),
      ciphertext: toBase64(ciphertext),
    },
    sender,
  };
}

/** Decrypts a sealed message with the recipient's secret key. Throws on any tampering. */
export function open(s: Sealed, recipient: X25519Keypair, context: string): Uint8Array {
  const senderPub = fromBase64(s.client_pub);
  const nonce = fromBase64(s.nonce);
  const ciphertext = fromBase64(s.ciphertext);
  if (senderPub.length !== 32 || nonce.length !== 24) throw new Error("malformed sealed message");
  if (ciphertext.length > MAX_SEALED_BYTES) throw new Error("sealed message too large");
  const shared = x25519.getSharedSecret(recipient.secretKey, senderPub);
  const key = deriveKey(shared, senderPub, recipient.publicKey, context);
  try {
    return xchacha20poly1305(key, nonce, utf8(context)).decrypt(ciphertext);
  } finally {
    shared.fill(0);
    key.fill(0);
  }
}

export const sealJson = (value: unknown, recipientPub: Uint8Array, context: string, sender?: X25519Keypair) =>
  seal(utf8(JSON.stringify(value)), recipientPub, context, sender);

export const openJson = <T>(s: Sealed, recipient: X25519Keypair, context: string): T =>
  JSON.parse(fromUtf8(open(s, recipient, context))) as T;
