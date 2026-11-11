// HTTP surface of the underwriter (BUILD_PLAN §9.7): GET /session, POST /underwrite, GET /health.
import {
  fromBase64,
  MAX_SEALED_BYTES,
  openJson,
  RpcDisagreement,
  sealJson,
  type Sealed,
  UNDERWRITE_CONTEXT,
  UNDERWRITE_RESPONSE_CONTEXT,
} from "@runway/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { errorCode, type SessionKeys } from "@runway/agent-kit";
import { RequestRejected, underwrite, type UnderwriteDeps, type UnderwriteRequest } from "./underwrite.js";

export { UNDERWRITE_CONTEXT, UNDERWRITE_RESPONSE_CONTEXT };

const SealedSchema = z
  .object({
    client_pub: z.string().max(64),
    nonce: z.string().max(64),
    ciphertext: z.string().max(Math.ceil((MAX_SEALED_BYTES * 4) / 3) + 4),
  })
  .strict();

const RequestSchema = z
  .object({
    handle: z.string().regex(/^[a-z0-9]{2,32}$/),
    nep413: z.object({
      accountId: z.string().min(2).max(64),
      publicKey: z.string().max(100),
      signature: z.string().max(200),
      message: z.string().max(500),
      nonce: z.string().max(64),
      recipient: z.string().max(100),
      callbackUrl: z.string().max(500).nullable().optional(),
    }),
    stripe_key: z.string().max(200).optional(),
    razorpay: z
      .object({ keyId: z.string().max(64), keySecret: z.string().max(128), accountId: z.string().max(64) })
      .optional(),
    statements: z
      .array(
        z.object({
          name: z.string().max(200),
          mime: z.enum(["text/csv", "application/pdf"]),
          data_b64: z.string().max(14_000_000),
        }),
      )
      .max(3)
      .optional(),
  })
  .strict();

export interface ServerDeps extends UnderwriteDeps {
  session: SessionKeys;
  registered: () => Promise<boolean>;
  measurementsHash?: string;
}

export function createUnderwriterApp(d: ServerDeps): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", async (c) =>
    c.json({
      ok: true,
      network: d.endpoints.network,
      agent_account: d.signer.accountId(),
      registered: await d.registered().catch(() => false),
      measurements_hash: d.measurementsHash ?? null,
      revenue_source: d.endpoints.profile.revenueSource,
    }),
  );

  app.get("/session", (c) => {
    const s = d.session.current();
    if (!s) return c.json({ error: "no session key yet" }, 503);
    return c.json({ agent_account: d.signer.accountId(), session_pub: s.pubB58, expires_sec: s.expiresSec });
  });

  app.post("/underwrite", async (c) => {
    const len = Number(c.req.header("content-length") ?? "0");
    if (len > MAX_SEALED_BYTES * 1.4) return c.json({ error: "request too large" }, 413);
    const sealed = SealedSchema.safeParse(await c.req.json().catch(() => null));
    if (!sealed.success) return c.json({ error: "bad request" }, 400);
    const s = d.session.current();
    if (!s) return c.json({ error: "no session key yet" }, 503);

    let plain: unknown;
    try {
      plain = openJson<unknown>(sealed.data as Sealed, s.keypair, UNDERWRITE_CONTEXT);
    } catch {
      return c.json({ error: "cannot decrypt (stale session key?)" }, 400);
    }
    const req = RequestSchema.safeParse(plain);
    if (!req.success) return c.json({ error: "bad request" }, 400);

    try {
      const r = await underwrite(req.data as UnderwriteRequest, d);
      const reply = sealJson(
        {
          inputs: r.inputs,
          salt: r.salt,
          commitment: r.commitment ?? null,
          evidence: r.evidence,
          terms: r.terms ?? null,
        },
        fromBase64(sealed.data.client_pub),
        UNDERWRITE_RESPONSE_CONTEXT,
      );
      return c.json({
        decision: r.decision,
        offer_id: r.offer_id,
        reasons: r.reasons,
        terms: r.terms,
        sealed: reply.sealed,
      });
    } catch (e) {
      if (e instanceof RequestRejected) return c.json({ error: e.message }, e.status);
      if (e instanceof RpcDisagreement) {
        d.log.warn("rpc_disagreement", { handle: req.data.handle });
        return c.json({ error: "RPC providers disagree; refusing to underwrite" }, 503);
      }
      d.log.warn("underwrite_failed", { handle: req.data.handle, code: errorCode(e) });
      return c.json({ error: "underwriting failed", code: errorCode(e) }, 500);
    } finally {
      plain = undefined;
    }
  });

  return app;
}
