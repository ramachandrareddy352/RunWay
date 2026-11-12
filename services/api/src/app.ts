// HTTP API (BUILD_PLAN T2.3, Amendment A1). Public, untrusted data only: the TEE underwriter never
// trusts this list, it re-verifies every payment itself.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Chain } from "./chain.js";
import type { PaymentStore } from "./store.js";

export type Network = "sandbox" | "testnet" | "mainnet";

export interface AppDeps {
  store: PaymentStore;
  chain: Chain;
  network: Network;
  /** Requests per minute per client for write routes. */
  writesPerMinute?: number;
  now?: () => number;
}

const handle = z.string().regex(/^[a-z0-9]{2,32}$/);
// 1Click deposit addresses are chain-specific; accept the printable set they use.
const depositAddress = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const MAX_SIMULATED = 100_000n * 1_000_000n; // 100k USDC per simulated payment

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;
  const limit = d.writesPerMinute ?? 30;
  const hits = new Map<string, { windowStart: number; n: number }>();

  const rateLimited = (client: string): boolean => {
    const t = now();
    const h = hits.get(client);
    if (!h || t - h.windowStart >= 60_000) {
      hits.set(client, { windowStart: t, n: 1 });
      return false;
    }
    h.n += 1;
    return h.n > limit;
  };
  const clientOf = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true, network: d.network }));

  app.post("/payments", async (c) => {
    if (rateLimited(clientOf(c))) return c.json({ error: "rate limited" }, 429);
    const parsed = z
      .object({ handle, depositAddress })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request" }, 400);
    const { created } = d.store.add({ ...parsed.data, kind: "oneclick" });
    return c.json({ ok: true, created }, created ? 201 : 200);
  });

  // The INR gateway reports delivered UPI sales so the keeper settles them like any other inflow.
  // Untrusted like the rest of this log: a fake entry only makes the keeper call the permissionless
  // settle(), which splits whatever actually arrived.
  app.post("/payments/upi", async (c) => {
    if (rateLimited(clientOf(c))) return c.json({ error: "rate limited" }, 429);
    const parsed = z
      .object({ handle, paymentRefHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request" }, 400);
    const { created } = d.store.add({
      handle: parsed.data.handle,
      depositAddress: `upi-${parsed.data.paymentRefHash}`,
      kind: "upi",
      status: "SUCCESS",
    });
    return c.json({ ok: true, created }, created ? 201 : 200);
  });

  app.get("/payments/:handle", (c) => {
    const h = handle.safeParse(c.req.param("handle"));
    if (!h.success) return c.json({ error: "bad request" }, 400);
    return c.json(
      d.store.list(h.data).map((p) => ({
        depositAddress: p.depositAddress,
        kind: p.kind,
        status: p.status,
        amountOut: p.amountOut,
        settledTx: p.settledTx,
        updatedAt: p.updatedAt,
      })),
    );
  });

  // SIMULATED (testnet) payment: mints mock USDC to the merchant's settlement account; the keeper
  // then settles it like any other successful payment. Never mounted on mainnet (test A4).
  if (d.network !== "mainnet") {
    app.post("/dev/simulate-payment", async (c) => {
      if (rateLimited(clientOf(c))) return c.json({ error: "rate limited" }, 429);
      const parsed = z
        .object({ handle, amount: z.string().regex(/^[1-9]\d{0,15}$/) })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "bad request" }, 400);
      const amount = BigInt(parsed.data.amount);
      if (amount > MAX_SIMULATED) return c.json({ error: "amount too large" }, 400);
      const settlement = await d.chain.settlementOf(parsed.data.handle);
      if (!settlement) return c.json({ error: "unknown merchant" }, 404);
      const tx = await d.chain.mint(settlement, amount);
      const id = `sim-${tx}`;
      d.store.add({
        handle: parsed.data.handle,
        depositAddress: id,
        kind: "simulated",
        status: "SUCCESS",
        amountOut: amount.toString(),
      });
      return c.json({ ok: true, simulated: true, depositAddress: id, mintTx: tx }, 201);
    });
  }

  return app;
}
