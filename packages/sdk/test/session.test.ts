import { describe, expect, it } from "vitest";
import {
  checkSession,
  encodeSessionPub,
  fromBase64,
  newX25519Keypair,
  open,
  openJson,
  seal,
  sealJson,
  signNep413,
  toBase64,
  utf8,
  verifySignature,
  type AgentView,
} from "../src/index.js";

describe("bytes", () => {
  it("base64 matches Node's encoder for every length", () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(toBase64(b)).toBe(Buffer.from(b).toString("base64"));
      expect([...fromBase64(toBase64(b))]).toEqual([...b]);
    }
  });
});

describe("seal", () => {
  const agent = newX25519Keypair();

  it("round-trips and lets the client open the reply", () => {
    const { sealed, sender } = sealJson({ hello: "priya" }, agent.publicKey, "underwrite");
    expect(openJson(sealed, agent, "underwrite")).toEqual({ hello: "priya" });
    const reply = sealJson({ ok: true }, fromBase64(sealed.client_pub), "underwrite-response");
    expect(openJson(reply.sealed, sender, "underwrite-response")).toEqual({ ok: true });
  });

  it("rejects tampering, the wrong context and the wrong key", () => {
    const { sealed } = seal(utf8("secret"), agent.publicKey, "underwrite");
    const ct = fromBase64(sealed.ciphertext);
    ct[0] = ct[0]! ^ 1;
    expect(() => open({ ...sealed, ciphertext: toBase64(ct) }, agent, "underwrite")).toThrow();
    expect(() => open(sealed, agent, "beneficiary")).toThrow();
    expect(() => open(sealed, newX25519Keypair(), "underwrite")).toThrow();
  });
});

describe("checkSession", () => {
  const now = 1_800_000_000_000;
  const key = encodeSessionPub(newX25519Keypair().publicKey);
  const agent = (over: Partial<AgentView> = {}): AgentView => ({
    account_id: "agent.test",
    measurements_hash: "h",
    valid_until_ms: String(now + 60_000),
    role: "Underwriter",
    valid: true,
    session_pub: key,
    session_expires_sec: String(now / 1000 + 3_600),
    ...over,
  });
  const served = { agent_account: "agent.test", session_pub: key, expires_sec: now / 1000 + 3_600 };
  const run = (a: AgentView | null, s = served) =>
    checkSession(s, async () => a, { role: "Underwriter", nowMs: now });

  it("accepts a matching, unexpired key", async () => {
    expect((await run(agent())).ok).toBe(true);
  });

  it("E1: a session key that doesn't match the chain is rejected", async () => {
    const other = encodeSessionPub(newX25519Keypair().publicKey);
    const r = await run(agent(), { ...served, session_pub: other });
    expect(r).toEqual({ ok: false, reason: "served session key does not match the chain" });
  });

  it("E2: an expired agent or session is rejected", async () => {
    expect(await run(agent({ valid_until_ms: String(now - 1) }))).toMatchObject({ ok: false });
    expect(await run(agent({ session_expires_sec: String(now / 1000 - 1) }))).toEqual({
      ok: false,
      reason: "session key expired",
    });
  });

  it("rejects unregistered agents, the wrong role and invalid registrations", async () => {
    expect(await run(null)).toMatchObject({ ok: false });
    expect(await run(agent({ role: "InrGateway" }))).toMatchObject({ ok: false });
    expect(await run(agent({ valid: false }))).toMatchObject({ ok: false });
  });
});

describe("signNep413", () => {
  it("produces signatures verifySignature accepts, and fails after tampering", () => {
    // A fixed sandbox-style key: 32-byte seed followed by its public key (base58 of 64 bytes).
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const sk = `ed25519:${encodeSessionPub(seed)}`;
    const s = signNep413({ message: "underwrite priya", recipient: "runway-underwriter" }, "priya.test", sk);
    expect(verifySignature(s)).toBe(true);
    expect(verifySignature({ ...s, message: "underwrite mallory" })).toBe(false);
    expect(verifySignature({ ...s, recipient: "elsewhere" })).toBe(false);
  });
});
