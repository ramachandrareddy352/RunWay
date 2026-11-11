// K_app: the app-wide key used for anchor HMACs and beneficiary blobs (design §8.4 step 5).
// In a TEE it comes from Dstack's key derivation (`getKey(path)`), which is bound to the app and not
// to one instance (SP7 confirms stability once a Phala deployment exists). In local mode it is derived
// from a configured seed and is NOT protected by hardware; the UI says so.
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Encode, utf8 } from "@runway/sdk";

export interface AppKeySource {
  readonly kind: "dstack" | "local";
  appKey(path: string): Promise<Uint8Array>;
}

export function localKeySource(seed: string): AppKeySource {
  if (seed.length < 16) throw new Error("local key seed must be at least 16 characters");
  return {
    kind: "local",
    appKey: async (path) => hkdf(sha256, utf8(seed), utf8("runway-local-kapp"), utf8(path), 32),
  };
}

/** Dstack app key (TEE only). Loaded lazily so local runs and tests don't need the socket. */
export function dstackKeySource(endpoint?: string): AppKeySource {
  return {
    kind: "dstack",
    async appKey(path) {
      const { DstackClient } = await import("@phala/dstack-sdk");
      const r = await new DstackClient(endpoint).getKey(path, "runway");
      if (r.key.length < 32) throw new Error("dstack key too short");
      return sha256(r.key);
    },
  };
}

/** `HMAC-SHA256(K_app, label)` as base58 (anchor hashes, payer refs). */
export const hmacB58 = (kApp: Uint8Array, label: string): string =>
  base58Encode(hmac(sha256, kApp, utf8(label)));
