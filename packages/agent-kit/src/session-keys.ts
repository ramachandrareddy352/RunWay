// X25519 session key published on-chain with `set_session_key` and rotated every 24 h
// (design §8.2, BUILD_PLAN T3.2). The secret never leaves this process.
import { encodeSessionPub, newX25519Keypair, type X25519Keypair } from "@runway/sdk";
import { TGAS, type AgentSigner } from "./chain.js";

export interface Session {
  keypair: X25519Keypair;
  pubB58: string;
  expiresSec: number;
}

export const SESSION_TTL_SEC = 24 * 3_600;

export class SessionKeys {
  private active?: Session;
  /** The previous key stays usable briefly so in-flight requests made just before a rotation work. */
  private previous?: Session;

  constructor(
    private readonly signer: AgentSigner,
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  current(): Session | undefined {
    return this.active;
  }

  async rotate(): Promise<Session> {
    const keypair = newX25519Keypair();
    const s: Session = {
      keypair,
      pubB58: encodeSessionPub(keypair.publicKey),
      expiresSec: this.nowSec() + SESSION_TTL_SEC,
    };
    await this.signer.call(
      "set_session_key",
      { pubkey_b58: s.pubB58, expires_sec: String(s.expiresSec) },
      { gas: 30n * TGAS },
    );
    this.previous?.keypair.secretKey.fill(0);
    this.previous = this.active;
    this.active = s;
    return s;
  }

  /** Rotates now, then every 23 hours (before the on-chain expiry). */
  start(onError: (e: unknown) => void): () => void {
    const t = setInterval(() => this.rotate().catch(onError), 23 * 3_600_000);
    return () => clearInterval(t);
  }
}
