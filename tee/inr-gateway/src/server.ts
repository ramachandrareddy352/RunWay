// INR Gateway HTTP (BUILD_PLAN §9.9). Mock routes are mounted only by mock-routes.ts, which main.ts
// imports dynamically on non-mainnet builds, so a mainnet bundle contains none of it (E22).
import { errorCode, type Logger, type SessionKeys } from "@runway/agent-kit";
import type { Oracle } from "@runway/fx";
import type { FloatView } from "@runway/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { BeneficiaryRejected, registerBeneficiary, type BeneficiaryDeps } from "./beneficiary.js";
import { CollectRefused, createCollect, handleWebhook, type PayinDeps } from "./payin.js";

export interface GatewayServerDeps {
  network: string;
  payin: PayinDeps;
  beneficiary: BeneficiaryDeps;
  session: SessionKeys;
  oracle: Oracle;
  log: Logger;
  registered: () => Promise<boolean>;
  /** Non-mainnet builds only: mounts the SIMULATED UPI page and actions. */
  mountMock?: (app: Hono) => void;
}

const CollectBody = z
  .object({
    kind: z.enum(["merchant_sale", "lender_deposit", "repayment"]),
    handle: z.string().max(32).optional(),
    beneficiary: z.string().max(64).optional(),
    loan_id: z.string().max(20).optional(),
    amount_paise: z.string().max(17),
  })
  .strict();

const SealedBody = z
  .object({ client_pub: z.string().max(64), nonce: z.string().max(64), ciphertext: z.string().max(8_192) })
  .strict();

export function createGatewayApp(d: GatewayServerDeps): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", async (c) => {
    const oracle = await d.oracle.read().catch(() => null);
    let float: FloatView | null = null;
    try {
      float = await (await d.payin.reader.snapshot()).view<FloatView>(d.payin.ids.inr, "get_float");
    } catch {
      float = null;
    }
    return c.json({
      ok: true,
      network: d.network,
      provider: d.payin.provider.name,
      oracle: oracle && {
        rate_ppu: oracle.ratePpu,
        sources: oracle.used.map((u) => u.name),
        paused: oracle.paused,
        reason: oracle.reason ?? null,
      },
      float,
      agent_account: d.payin.signer.accountId(),
      registered: await d.registered().catch(() => false),
    });
  });

  app.get("/session", (c) => {
    const s = d.session.current();
    if (!s) return c.json({ error: "no session key yet" }, 503);
    return c.json({
      agent_account: d.payin.signer.accountId(),
      session_pub: s.pubB58,
      expires_sec: s.expiresSec,
    });
  });

  app.post("/inr/collect", async (c) => {
    const body = CollectBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad request" }, 400);
    try {
      return c.json(await createCollect(body.data, d.payin), 201);
    } catch (e) {
      if (e instanceof CollectRefused) return c.json({ error: e.message }, 422);
      d.log.warn("collect_failed", { code: errorCode(e) });
      return c.json({ error: "collect failed", code: errorCode(e) }, 503);
    }
  });

  app.get("/inr/collect/:id", (c) => {
    const row = d.payin.store.get(c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({
      status: row.status,
      kind: row.kind,
      amount_paise: row.amountPaise.toString(),
      rate_ppu_estimate: row.rateEstimate,
      usdc_estimate: row.usdcEstimate.toString(),
      expires_at: new Date(row.expiresAt).toISOString(),
      payment_ref_hash: row.paymentRefHash ?? undefined,
      reason: row.reason ?? undefined,
      simulated: row.simulated,
    });
  });

  app.post("/inr/webhook/:provider", async (c) => {
    if (c.req.param("provider") !== d.payin.provider.name) return c.json({ error: "unknown provider" }, 404);
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    try {
      const ok = await handleWebhook(raw, headers, d.payin);
      return ok ? c.json({ ok: true }) : c.json({ error: "bad signature" }, 400);
    } catch (e) {
      // Accepted; the payment stays pending and is re-checked (idempotent).
      d.log.warn("webhook_processing_failed", { code: errorCode(e) });
      return c.json({ ok: true });
    }
  });

  app.post("/inr/beneficiary", async (c) => {
    const body = SealedBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad request" }, 400);
    try {
      return c.json(await registerBeneficiary(body.data, d.beneficiary));
    } catch (e) {
      if (e instanceof BeneficiaryRejected) return c.json({ error: e.message }, 400);
      d.log.warn("beneficiary_failed", { code: errorCode(e) });
      return c.json({ error: "registration failed", code: errorCode(e) }, 503);
    }
  });

  d.mountMock?.(app);
  return app;
}
